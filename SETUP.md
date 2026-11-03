# MP3: APIed Piper — setup and test guide

This is an original implementation matching the assignment's Node + Express +
Mongoose requirements. The instructor's repository template was not available in
this environment; use **your own GitHub template repository** and preserve the
instructor's `submit.js`, autograder URL, and `.gitignore`.

## 1. Prerequisites

- Node 24 LTS (`node -v` must show `v24...`)
- GitHub repository created from the assignment template
- MongoDB Atlas account with an M0 cluster and a database user
- Render account for deployment

## 2. Project files

- `server.js`: all schemas, validation, query processing, REST routes, and two-way updates
- `package.json`: dependencies and npm scripts
- `.env.example`: environment variable sample, **not credentials**
- `.gitignore`: keeps `.env` and `node_modules` out of Git
- `scripts/check-api.js`: API integration check

If you already have the class template, copy `server.js` and `scripts/check-api.js`
into it. Keep the existing `submit.js`. Either merge `package.json` dependencies and
scripts with your template or use the package file here and keep `"submit":
"node submit.js"`. Do not delete the template `.gitignore`; merge if needed.

## 3. Configure MongoDB Atlas

1. Create your cluster and database user, retaining the username and password.
2. In Atlas, choose **Connect > Drivers** and copy the URI (Node.js driver).
3. Replace the URI placeholders with the username, *URL-encoded* password, and
   database name `mp3`.
4. Under Network Access, add the IP access requested by the assignment. It
   specifies `0.0.0.0/0` for grading; this is risky for production. Keep the
   database user's permissions limited and tighten access after grading.

Create `.env` beside `server.js`, containing:

```
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/mp3?retryWrites=true&w=majority
PORT=3000
```

Use your actual URI from Atlas; the above is only a placeholder. Do not commit
`.env` or post its contents publicly.

### Windows PowerShell

```
Copy-Item .env.example .env
npm install
npm start
```

### macOS / Linux

```
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000/api/users` in the browser; a new DB should return
`{ "message": "OK", "data": [] }`.

## 4. Test locally

Open a second terminal and run:

```
npm run test:api
```

That script creates temporary users/tasks, tests validation and two-way
references, and cleans up those records. It checks a representative subset of
requirements, not all private autograder cases.

For a manual test in PowerShell:

```
Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/users `
  -ContentType 'application/json' `
  -Body '{"name":"Ada","email":"ada@example.com"}'
```

## 5. Deploy on Render

1. Push the project to your own *public* GitHub repo; verify `.env` is NOT tracked.
2. In Render, create a **Web Service** from that GitHub repository.
3. Set runtime to Node, build command to `npm install`, and start command to
   `npm start`; ensure the service uses Node 24 LTS (this project declares it
   in `package.json` and `.node-version`).
4. In the Render Environment settings, add `MONGODB_URI` with your Atlas URI.
   Render supplies its own `PORT` if needed; the code respects it.
5. Deploy, then open `https://YOUR-SERVICE.onrender.com/api/users`.

## 6. Run the required class autograder

The original instructor template contains `submit.js`. Set its `API_URL` to
`https://YOUR-SERVICE.onrender.com` (without `/api`). Do not change
`AUTOGRADER_URL`. Run:

```
npm run submit
```

Resolve any reported issues and repeat within the provided rate limit. The
script only checks; it does **not** complete the class submission process.
Follow your course's actual submission instructions for the GitHub link and
any other deliverables. The pasted assignment stopped before its "Submission
Details" section, so verify the full instructions in Canvas/GitHub.

## 7. How consistency is maintained

Every write that touches more than one collection runs inside a MongoDB
transaction. Before writing, the API checks fields and references. For example:

- `POST/PUT /tasks`: clear old `pendingTasks` references; add new one only if
  the task is assigned and incomplete.
- `POST/PUT /users`: validate all requested pending task IDs, transfer those
  tasks away from previous users, unassign omitted pending tasks, and update
  the name on all tasks (including completed tasks) still assigned to the user.
- `DELETE /tasks/:id`: remove it from pending lists.
- `DELETE /users/:id`: unassign all their tasks, even completed tasks.

## 8. Disclosure

The assignment asks you to declare external sources. Since you received
permission to use LLM assistance, disclose that AI assisted in preparing
and reviewing implementation code. Also declare any external documentation or
libraries you referenced, as the instructor requires. Ensure that the final
submission conforms to the exact exception your professor granted.
