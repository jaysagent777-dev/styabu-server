const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const db = require("./db");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "styabu-secret-key-change-in-production";

app.use(cors());
app.use(express.json());

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ── Auth ──────────────────────────────────────────────

app.post("/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "All fields required" });
  try {
    const hashed = bcrypt.hashSync(password, 10);
    const result = await db.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id",
      [name, email, hashed]
    );
    const id = result.rows[0].id;
    const token = jwt.sign({ id, name, email }, JWT_SECRET);
    res.json({ token, user: { id, name, email } });
  } catch {
    res.status(400).json({ error: "Email already exists" });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
  const user = result.rows[0];
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/auth/google", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "ID token required" });
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: googleId, email, name } = ticket.getPayload();
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user) {
      // New user — tell frontend to complete sign up
      return res.json({ newUser: true, googleData: { name, email, googleId } });
    }
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(401).json({ error: "Invalid Google token" });
  }
});

app.post("/auth/google/register", async (req, res) => {
  const { name, email, googleId } = req.body;
  if (!name || !email || !googleId) return res.status(400).json({ error: "Missing fields" });
  try {
    const insert = await db.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id",
      [name, email, `google_${googleId}`]
    );
    const id = insert.rows[0].id;
    const token = jwt.sign({ id, name, email }, JWT_SECRET);
    res.json({ token, user: { id, name, email } });
  } catch {
    res.status(400).json({ error: "Email already exists" });
  }
});

// ── Ideas ─────────────────────────────────────────────

app.get("/ideas", async (req, res) => {
  const { search } = req.query;
  let sql = `
    SELECT i.*, u.name as author_name,
      (SELECT COUNT(*) FROM group_members gm JOIN groups g ON gm.group_id = g.id WHERE g.idea_id = i.id) as member_count
    FROM ideas i JOIN users u ON i.author_id = u.id
  `;
  const params = [];
  if (search) {
    sql += " WHERE (i.title ILIKE $1 OR i.description ILIKE $1)";
    params.push(`%${search}%`);
  }
  sql += " ORDER BY i.created_at DESC";
  const result = await db.query(sql, params);
  res.json(result.rows.map((i) => ({
    ...i,
    skills_needed: JSON.parse(i.skills_needed),
    tags: JSON.parse(i.tags),
  })));
});

app.post("/ideas", auth, async (req, res) => {
  const { title, description, skills_needed, tags, max_members } = req.body;
  if (!title || !description)
    return res.status(400).json({ error: "Title and description required" });

  const ideaResult = await db.query(
    "INSERT INTO ideas (title, description, author_id, skills_needed, tags, max_members) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [title, description, req.user.id, JSON.stringify(skills_needed || []), JSON.stringify(tags || []), max_members || 4]
  );
  const ideaId = ideaResult.rows[0].id;

  const groupResult = await db.query(
    "INSERT INTO groups (idea_id, name) VALUES ($1,$2) RETURNING id",
    [ideaId, title]
  );
  const groupId = groupResult.rows[0].id;

  await db.query(
    "INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,$3)",
    [groupId, req.user.id, "owner"]
  );

  res.json({ id: ideaId });
});

app.post("/ideas/:id/like", auth, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("INSERT INTO idea_likes (user_id, idea_id) VALUES ($1,$2)", [req.user.id, id]);
    await db.query("UPDATE ideas SET likes = likes + 1 WHERE id = $1", [id]);
    res.json({ liked: true });
  } catch {
    await db.query("DELETE FROM idea_likes WHERE user_id = $1 AND idea_id = $2", [req.user.id, id]);
    await db.query("UPDATE ideas SET likes = likes - 1 WHERE id = $1", [id]);
    res.json({ liked: false });
  }
});

// ── Join Requests ─────────────────────────────────────

app.post("/ideas/:id/request", auth, async (req, res) => {
  const { message } = req.body;
  try {
    await db.query(
      "INSERT INTO join_requests (idea_id, user_id, message) VALUES ($1,$2,$3)",
      [req.params.id, req.user.id, message || ""]
    );
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Already requested" });
  }
});

app.get("/ideas/:id/requests", auth, async (req, res) => {
  const result = await db.query(`
    SELECT jr.*, u.name, u.skills FROM join_requests jr
    JOIN users u ON jr.user_id = u.id
    WHERE jr.idea_id = $1 AND jr.status = 'pending'
  `, [req.params.id]);
  res.json(result.rows);
});

app.post("/requests/:id/approve", auth, async (req, res) => {
  const reqResult = await db.query("SELECT * FROM join_requests WHERE id = $1", [req.params.id]);
  const request = reqResult.rows[0];
  if (!request) return res.status(404).json({ error: "Not found" });

  const groupResult = await db.query("SELECT * FROM groups WHERE idea_id = $1", [request.idea_id]);
  const group = groupResult.rows[0];
  await db.query("INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)", [group.id, request.user_id]);
  await db.query("UPDATE join_requests SET status = 'approved' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

// ── Groups ────────────────────────────────────────────

app.get("/groups/mine", auth, async (req, res) => {
  const groupsResult = await db.query(`
    SELECT g.*, i.title as idea_title, i.description as idea_description
    FROM groups g
    JOIN ideas i ON g.idea_id = i.id
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = $1
  `, [req.user.id]);

  const groups = await Promise.all(groupsResult.rows.map(async (g) => {
    const membersResult = await db.query(`
      SELECT u.id, u.name, u.skills, gm.role FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
    `, [g.id]);
    return { ...g, members: membersResult.rows };
  }));

  res.json(groups);
});

app.patch("/groups/:id/stage", auth, async (req, res) => {
  await db.query("UPDATE groups SET stage = $1 WHERE id = $2", [req.body.stage, req.params.id]);
  res.json({ success: true });
});

// ── Profile ───────────────────────────────────────────

app.get("/profile", auth, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, email, skills, availability, location FROM users WHERE id = $1",
    [req.user.id]
  );
  const user = result.rows[0];
  res.json({ ...user, skills: JSON.parse(user.skills) });
});

app.patch("/profile", auth, async (req, res) => {
  const { skills, availability, location, name } = req.body;
  await db.query(
    "UPDATE users SET skills=$1, availability=$2, location=$3, name=$4 WHERE id=$5",
    [JSON.stringify(skills || []), availability || "side project", location || "", name || "", req.user.id]
  );
  res.json({ success: true });
});

app.get("/health", (_, res) => res.json({ status: "ok", app: "Styabu" }));

app.listen(PORT, () => console.log(`Styabu server running on port ${PORT}`));
