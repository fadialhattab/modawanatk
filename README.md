# خواطر — Khawatir

Arabic RTL thoughts app based on the supplied screenshot. React + JavaScript + Bootstrap, Express on Node.js, MongoDB Atlas with Mongoose.

## Included
- Responsive teal/cream interface, public recent-post feed, personal-post view.
- Registration, sign-in, sign-out with an HttpOnly session cookie.
- Create, edit and delete posts. Server verifies ownership for every mutation.
- Passwords hashed with salted scrypt; request validation, rate limits, same-origin checks and Helmet.
- Separate browser-only preview mode. It does not connect to Atlas and does not create real accounts.

## Run on Windows
Install Node.js 22 or newer. Extract the folder and open its terminal:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` with your MongoDB Atlas driver connection string. Use a database user limited to the `khawatir` database, and allow your machine's current public IP in Atlas Network Access. URL-encode any special characters in the password embedded in the URI. Do not put credentials in React files or variables beginning with `VITE_`.

Generate a session secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the result to `JWT_SECRET` in `.env`, then:

```powershell
npm run dev
```

Open http://localhost:5173. Express runs on port 5000; Vite proxies `/api` to it. Keep `APP_ORIGIN=http://localhost:5173` for development. The server deliberately refuses to start without the database URI and secret.

## Run the production build locally

```powershell
npm run build
```

Set `APP_ORIGIN=http://localhost:5000` in `.env`, keep `NODE_ENV=development` for local HTTP, then run `npm start`. Open http://localhost:5000.

For a public deployment, use a Node.js-capable host, set `NODE_ENV=production`, set `APP_ORIGIN` to your exact HTTPS origin, configure `MONGODB_URI` and `JWT_SECRET` as server secrets, and use HTTPS. Set `TRUST_PROXY=1` only behind exactly one trusted reverse proxy. Atlas must permit the host's egress IP. The Express server serves the React build and API from one origin.

## Preview without a database

```powershell
npm run build:preview
npx vite preview
```

This explicitly labeled preview stores posts in this browser's localStorage. Registration is unavailable there. Run `npm run build` again before deploying the real server; never deploy the preview build as the live database-backed app.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /api/auth/register | name, email, password |
| POST | /api/auth/login | email, password |
| POST | /api/auth/logout | Clear session |
| GET | /api/auth/me | Current user or null |
| GET | /api/posts?page=1 | Latest 100 posts per page |
| POST | /api/posts | Authenticated; title and body |
| PUT | /api/posts/:id | Owner only; title and body |
| DELETE | /api/posts/:id | Owner only |
| GET | /api/health | Database readiness |

The UI shows the most recent 100 posts. Password reset, email verification and moderation are outside this initial version. Signed-out users can read posts. Content is rendered as plain text, not HTML.

## Validation status
`npm test` checks field validation, whitespace handling, oversized inputs and forged input fields. The production and preview builds have been compiled. A real Atlas connection, account lifecycle and multi-user database flows still need end-to-end testing with your Atlas configuration; no database credentials were provided.
