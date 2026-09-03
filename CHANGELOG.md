# Changelog

## 0.9.5

- Preserve all `Set-Cookie` headers when forwarding a Web `Response` to Node.js. Authentication callbacks can now set a session token alongside state and cache cookies without losing earlier cookies and redirecting users back to login.
- Add regression coverage for redirects with zero, one, and multiple cookies, including cookie expiration dates containing commas.
