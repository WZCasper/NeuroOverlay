import { json } from "../http.js";

function serializeAdminUser(user) {
  return {
    id: user.id,
    telegramId: String(user.telegram_id),
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    isAdmin: !!user.is_admin,
    createdAt: user.created_at,
  };
}

// The site is free, so there is nothing to grant here -- this is just a
// read-only view so the site owner can see who's using it.
export async function handleListUsers(request, env, ctx, user) {
  if (!user) return json({ error: "not_authenticated" }, { status: 401 });
  if (!user.is_admin) return json({ error: "not_admin" }, { status: 403 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  let result;
  if (q) {
    result = await env.DB.prepare(
      `SELECT * FROM users WHERE username LIKE ? OR first_name LIKE ? OR telegram_id = ?
       ORDER BY created_at DESC LIMIT 50`
    )
      .bind(`%${q}%`, `%${q}%`, q)
      .all();
  } else {
    result = await env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT 50").all();
  }
  const countRow = await env.DB.prepare("SELECT count(*) AS n FROM users").first();

  return json({ users: result.results.map(serializeAdminUser), totalUsers: countRow.n });
}
