const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory user store (replace with a database later)
const users = [];

// Serve static files from project root
app.use(express.static(path.join(__dirname)));

// Simple session tracking via a cookie-like token
// (In production, use express-session or JWT)
const sessions = new Map();

function generateToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---- Auth API ----

// Register
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Alle felt er påkrevd.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Passord må være minst 6 tegn.' });
  }

  if (users.find(u => u.email === email)) {
    return res.status(409).json({ error: 'E-posten er allerede registrert.' });
  }

  const user = { id: users.length + 1, name, email, password };
  users.push(user);

  const token = generateToken();
  sessions.set(token, user.id);

  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'E-post og passord er påkrevd.' });
  }

  const user = users.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Feil e-post eller passord.' });
  }

  const token = generateToken();
  sessions.set(token, user.id);

  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// Get current user
app.get('/api/me', (req, res) => {
  const token = req.headers.authorization;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Ikke innlogget.' });
  }

  const userId = sessions.get(token);
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: 'Bruker ikke funnet.' });
  }

  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

// Logout
app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization;
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`nailed server running on http://localhost:${PORT}`);
});
