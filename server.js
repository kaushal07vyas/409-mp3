'use strict';

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// Kept as strings because the assignment requires pendingTasks and assignedUser
// to hold textual task/user IDs, not arrays of ObjectId values.
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, unique: true },
  pendingTasks: { type: [String], default: [] },
  dateCreated: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

const taskSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  deadline: { type: Date, required: true },
  completed: { type: Boolean, default: false },
  assignedUser: { type: String, default: '' },
  assignedUserName: { type: String, default: 'unassigned' },
  dateCreated: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new ApiError(status, message); };
const send = (res, status, data, message = 'OK') =>
  res.status(status).json({ message, data });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);

function requireBody(body) {
  if (!isObject(body)) fail(400, 'The request body must be a JSON object.');
}
function nonemptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(400, `${field} must be a non-empty string.`);
  }
  return value.trim();
}
function parseDate(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(400, `${field} must be a valid date string.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(400, `${field} must be a valid date string.`);
  return date;
}
function requireUrlId(id) {
  if (!validId(id)) fail(404, 'Resource not found.');
}

function parseUser(body) {
  requireBody(body);
  const name = nonemptyString(body.name, 'name');
  const email = nonemptyString(body.email, 'email');
  const pending = body.pendingTasks === undefined ? [] : body.pendingTasks;
  if (!Array.isArray(pending) || pending.some(id => typeof id !== 'string')) {
    fail(400, 'pendingTasks must be an array of task ID strings.');
  }
  if (pending.some(id => !validId(id))) {
    fail(400, 'pendingTasks contains an invalid task ID.');
  }
  // Duplicate entries do not represent distinct tasks.
  return { name, email, pendingTasks: [...new Set(pending.map(id => id.toLowerCase()))] };
}

function parseTask(body) {
  requireBody(body);
  const name = nonemptyString(body.name, 'name');
  const deadline = parseDate(body.deadline, 'deadline');
  const description = body.description === undefined ? '' : body.description;
  const completed = body.completed === undefined ? false : body.completed;
  const assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
  const assignedUserName = body.assignedUserName;
  if (typeof description !== 'string') fail(400, 'description must be a string.');
  if (typeof completed !== 'boolean') fail(400, 'completed must be a boolean.');
  if (typeof assignedUser !== 'string' || (assignedUser !== '' && !validId(assignedUser))) {
    fail(400, 'assignedUser must be an existing user ID or an empty string.');
  }
  if (assignedUserName !== undefined && typeof assignedUserName !== 'string') {
    fail(400, 'assignedUserName must be a string.');
  }
  return { name, description, deadline, completed,
    assignedUser: assignedUser.toLowerCase(), assignedUserName };
}

// Collection query strings are JSON-encoded, as specified in the assignment.
function parseJsonParam(raw, field) {
  try { return JSON.parse(raw); }
  catch { fail(400, `${field} must be valid JSON.`); }
}
function parseMapParam(raw, field, allowed) {
  if (raw === undefined) return undefined;
  const value = parseJsonParam(raw, field);
  if (!isObject(value)) fail(400, `${field} must be a JSON object.`);
  if (allowed && Object.values(value).some(v => !allowed.includes(v))) {
    fail(400, `${field} contains an invalid value.`);
  }
  return value;
}
function parseIntegerParam(raw, field) {
  if (raw === undefined) return undefined;
  const value = parseJsonParam(raw, field);
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(400, `${field} must be a nonnegative integer.`);
  }
  return value;
}
function parseSelect(raw) { return parseMapParam(raw, 'select', [0, 1]); }

function parseCollectionQuery(query, isTask) {
  const where = parseMapParam(query.where, 'where') || {};
  const sort = parseMapParam(query.sort, 'sort', [-1, 1]);
  const select = parseSelect(query.select);
  const skip = parseIntegerParam(query.skip, 'skip') ?? 0;
  const limit = parseIntegerParam(query.limit, 'limit') ?? (isTask ? 100 : undefined);
  const count = query.count === undefined ? false : parseJsonParam(query.count, 'count');
  if (typeof count !== 'boolean') fail(400, 'count must be true or false.');
  return { where, sort, select, skip, limit, count };
}

// Wrapper also works with Express 4 (if the original template uses it).
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

async function listDocuments(Model, req, res, isTask) {
  const { where, sort, select, skip, limit, count } = parseCollectionQuery(req.query, isTask);
  if (count) return send(res, 200, await Model.countDocuments(where));
  let query = Model.find(where);
  if (sort) query = query.sort(sort);
  if (select) query = query.select(select);
  if (skip) query = query.skip(skip);
  if (limit !== undefined) {
    if (limit === 0) return send(res, 200, []);
    query = query.limit(limit);
  }
  return send(res, 200, await query.exec());
}

async function getDocument(Model, req, res) {
  requireUrlId(req.params.id);
  // On /:id, only 'select' applies; all other query fields are ignored.
  const select = parseSelect(req.query.select);
  let query = Model.findById(req.params.id);
  if (select) query = query.select(select);
  const result = await query.exec();
  if (!result) fail(404, 'Resource not found.');
  send(res, 200, result);
}

async function verifyPendingTasks(ids, session) {
  if (!ids.length) return;
  const tasks = await Task.find({ _id: { $in: ids } }).session(session);
  // Validation errors take priority over missing references when both occur.
  if (tasks.some(task => task.completed)) {
    fail(400, 'A completed task cannot be included in pendingTasks.');
  }
  if (tasks.length !== ids.length) fail(404, 'One or more referenced tasks do not exist.');
}

async function verifyEmailAvailable(email, exceptId, session) {
  const existing = await User.findOne({ email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })
    .session(session);
  if (existing) fail(400, 'This email is already in use.');
}

// Shared POST/PUT users logic. Every related write is in one transaction.
async function writeUser(req, res, updating) {
  if (updating) requireUrlId(req.params.id);
  const result = await mongoose.connection.transaction(async session => {
    const current = updating ? await User.findById(req.params.id).session(session) : null;
    if (updating && !current) fail(404, 'User not found.');
    const input = parseUser(req.body);
    await verifyEmailAvailable(input.email, current?._id, session);
    await verifyPendingTasks(input.pendingTasks, session);

    const user = current || new User();
    user.name = input.name;
    user.email = input.email;
    user.pendingTasks = input.pendingTasks;
    await user.save({ session });
    const userId = String(user._id);

    // Old unfinished assignments not in the new list become unassigned.
    await Task.updateMany(
      { assignedUser: userId, completed: false,
        _id: { $nin: input.pendingTasks } },
      { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
      { session }
    );
    if (input.pendingTasks.length) {
      // A task transferred here must disappear from its previous owner's list.
      await User.updateMany(
        { _id: { $ne: user._id }, pendingTasks: { $in: input.pendingTasks } },
        { $pull: { pendingTasks: { $in: input.pendingTasks } } },
        { session }
      );
      await Task.updateMany(
        { _id: { $in: input.pendingTasks } },
        { $set: { assignedUser: userId, assignedUserName: user.name } },
        { session }
      );
    }
    // Also rename references on completed tasks that remain assigned.
    await Task.updateMany(
      { assignedUser: userId },
      { $set: { assignedUserName: user.name } },
      { session }
    );
    return user;
  });
  send(res, updating ? 200 : 201, result, updating ? 'User updated.' : 'User created.');
}

async function verifyAssignedUser(input, session) {
  if (!input.assignedUser) {
    if (input.assignedUserName !== undefined && input.assignedUserName !== 'unassigned') {
      fail(400, 'An unassigned task must have assignedUserName "unassigned".');
    }
    return 'unassigned';
  }
  const user = await User.findById(input.assignedUser).session(session);
  if (!user) fail(404, 'Assigned user not found.');
  if (input.assignedUserName !== undefined && input.assignedUserName !== user.name) {
    fail(400, 'assignedUserName does not match the assigned user.');
  }
  return user.name;
}

async function writeTask(req, res, updating) {
  if (updating) requireUrlId(req.params.id);
  const result = await mongoose.connection.transaction(async session => {
    const current = updating ? await Task.findById(req.params.id).session(session) : null;
    if (updating && !current) fail(404, 'Task not found.');
    const input = parseTask(req.body);
    const assignedName = await verifyAssignedUser(input, session);

    const task = current || new Task();
    task.name = input.name;
    task.description = input.description;
    task.deadline = input.deadline;
    task.completed = input.completed;
    task.assignedUser = input.assignedUser;
    task.assignedUserName = assignedName;
    await task.save({ session });
    const taskId = String(task._id);

    // Clear any old owner's pending reference (including on reassignment).
    await User.updateMany(
      { pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session }
    );
    if (task.assignedUser && !task.completed) {
      await User.updateOne(
        { _id: task.assignedUser },
        { $addToSet: { pendingTasks: taskId } },
        { session }
      );
    }
    return task;
  });
  send(res, updating ? 200 : 201, result, updating ? 'Task updated.' : 'Task created.');
}

app.get('/', (_req, res) => send(res, 200, { service: 'MP3 Task API' }));
app.get('/api/users', asyncRoute((req, res) => listDocuments(User, req, res, false)));
app.get('/api/tasks', asyncRoute((req, res) => listDocuments(Task, req, res, true)));
app.get('/api/users/:id', asyncRoute((req, res) => getDocument(User, req, res)));
app.get('/api/tasks/:id', asyncRoute((req, res) => getDocument(Task, req, res)));
app.post('/api/users', asyncRoute((req, res) => writeUser(req, res, false)));
app.post('/api/tasks', asyncRoute((req, res) => writeTask(req, res, false)));
app.put('/api/users/:id', asyncRoute((req, res) => writeUser(req, res, true)));
app.put('/api/tasks/:id', asyncRoute((req, res) => writeTask(req, res, true)));

app.delete('/api/tasks/:id', asyncRoute(async (req, res) => {
  requireUrlId(req.params.id);
  await mongoose.connection.transaction(async session => {
    const task = await Task.findById(req.params.id).session(session);
    if (!task) fail(404, 'Task not found.');
    const taskId = String(task._id);
    await User.updateMany(
      { pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session }
    );
    await Task.deleteOne({ _id: task._id }).session(session);
  });
  res.status(204).end();
}));

app.delete('/api/users/:id', asyncRoute(async (req, res) => {
  requireUrlId(req.params.id);
  await mongoose.connection.transaction(async session => {
    const user = await User.findById(req.params.id).session(session);
    if (!user) fail(404, 'User not found.');
    await Task.updateMany(
      { assignedUser: String(user._id) },
      { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
      { session }
    );
    await User.deleteOne({ _id: user._id }).session(session);
  });
  res.status(204).end();
}));

app.use((_req, _res, next) => next(new ApiError(404, 'Endpoint not found.')));
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof ApiError) return send(res, err.status, null, err.message);
  if (err?.code === 11000) return send(res, 400, null, 'This email is already in use.');
  if (err instanceof mongoose.Error.CastError || err instanceof mongoose.Error.ValidationError) {
    return send(res, 400, null, 'Invalid data or query parameter.');
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return send(res, 400, null, 'Request body is not valid JSON.');
  }
  console.error('Unexpected API error:', err); // details stay in server logs only
  send(res, 500, null, 'An internal server error occurred.');
});

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Set MONGODB_URI in your .env file or Render environment.');
  await mongoose.connect(uri);
  await User.init(); // Ensure the unique email index exists before serving writes.
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => console.log(`API listening on port ${port}`));
}
if (require.main === module) {
  main().catch(err => { console.error('Startup failed:', err); process.exit(1); });
}
module.exports = { app, User, Task, parseUser, parseTask, parseCollectionQuery };
