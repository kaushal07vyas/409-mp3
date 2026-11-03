'use strict';

// Integration smoke test. Run AFTER server and Atlas are working. Data created
// by this test is deleted at the end, including when an assertion fails.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const unique = randomUUID().slice(0, 8);
const createdUsers = [];
const createdTasks = [];

async function api(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (payload) {
    assert.equal(typeof payload.message, 'string', `No message: ${method} ${path}`);
    assert.ok(Object.hasOwn(payload, 'data'), `No data: ${method} ${path}`);
  }
  return { status: response.status, data: payload?.data, message: payload?.message };
}
function eqStatus(result, status, what) {
  assert.equal(result.status, status,
    `${what}: expected ${status} but got ${result.status} (${result.message})`);
}
const urlParam = obj => encodeURIComponent(JSON.stringify(obj));

async function test() {
  let r = await api('POST', '/api/users', { name: 'Ada', email: `ada-${unique}@example.com` });
  eqStatus(r, 201, 'create first user');
  const aliceId = r.data._id;
  createdUsers.push(aliceId);
  assert.deepEqual(r.data.pendingTasks, []);
  assert.ok(r.data.dateCreated);

  r = await api('POST', '/api/users', { name: 'Bob', email: `bob-${unique}@example.com` });
  eqStatus(r, 201, 'create second user');
  const bobId = r.data._id;
  createdUsers.push(bobId);

  eqStatus(await api('POST', '/api/users', { name: 'Duplicate', email: `ada-${unique}@example.com` }),
    400, 'duplicate email rejected');
  eqStatus(await api('POST', '/api/tasks', { name: 'Missing deadline' }),
    400, 'missing required deadline rejected');

  r = await api('POST', '/api/tasks', {
    name: 'Finish MP3', description: 'Write routes',
    deadline: '2026-12-01T00:00:00Z', assignedUser: aliceId
  });
  eqStatus(r, 201, 'create assigned task');
  const taskId = r.data._id;
  createdTasks.push(taskId);
  assert.equal(r.data.assignedUserName, 'Ada');

  r = await api('GET', `/api/users/${aliceId}`);
  eqStatus(r, 200, 'get user');
  assert.ok(r.data.pendingTasks.includes(taskId));

  r = await api('GET', `/api/tasks?where=${urlParam({ completed: false })}&count=true`);
  eqStatus(r, 200, 'get task count');
  assert.equal(typeof r.data, 'number');
  assert.ok(r.data >= 1);

  r = await api('GET', `/api/tasks?sort=${urlParam({ name: 1 })}&select=${urlParam({ _id: 0 })}&limit=5&skip=0`);
  eqStatus(r, 200, 'query combination');
  assert.ok(Array.isArray(r.data));
  assert.ok(r.data.every(t => !Object.hasOwn(t, '_id')));

  r = await api('GET', `/api/tasks/${taskId}?select=${urlParam({ name: 1, _id: 0 })}`);
  eqStatus(r, 200, 'select on detail');
  assert.deepEqual(r.data, { name: 'Finish MP3' });
  eqStatus(await api('GET', '/api/tasks?where=%7Bbroken'), 400, 'invalid JSON query');

  r = await api('PUT', `/api/tasks/${taskId}`, {
    name: 'Finish MP3', deadline: '2026-12-01T00:00:00Z',
    assignedUser: aliceId, completed: true
  });
  eqStatus(r, 200, 'complete assigned task');
  assert.equal(r.data.completed, true);
  r = await api('GET', `/api/users/${aliceId}`);
  assert.ok(!r.data.pendingTasks.includes(taskId), 'completed task still pending');

  r = await api('PUT', `/api/tasks/${taskId}`, {
    name: 'Finish MP3', deadline: '2026-12-01T00:00:00Z',
    assignedUser: bobId, completed: false
  });
  eqStatus(r, 200, 'reassign and reopen');
  r = await api('GET', `/api/users/${bobId}`);
  assert.ok(r.data.pendingTasks.includes(taskId), 'new user missing task');
  r = await api('GET', `/api/users/${aliceId}`);
  assert.ok(!r.data.pendingTasks.includes(taskId), 'old user still has task');

  eqStatus(await api('PUT', `/api/tasks/${taskId}`, {
    name: 'Wrong assignee name', deadline: '2026-12-01',
    assignedUser: bobId, assignedUserName: 'Ada'
  }), 400, 'name mismatch rejected');
  r = await api('GET', `/api/tasks/${taskId}`);
  assert.equal(r.data.assignedUserName, 'Bob', 'failed request mutated task');

  r = await api('PUT', `/api/users/${bobId}`, {
    name: 'Bobby', email: `bob-${unique}@example.com`, pendingTasks: [taskId]
  });
  eqStatus(r, 200, 'rename user with pending task');
  r = await api('GET', `/api/tasks/${taskId}`);
  assert.equal(r.data.assignedUserName, 'Bobby');

  r = await api('PUT', `/api/users/${bobId}`, {
    name: 'Bobby', email: `bob-${unique}@example.com`
  });
  eqStatus(r, 200, 'unassign by removing pending list');
  r = await api('GET', `/api/tasks/${taskId}`);
  assert.equal(r.data.assignedUser, '');
  assert.equal(r.data.assignedUserName, 'unassigned');

  eqStatus(await api('PUT', `/api/users/${bobId}`, {
    name: 'Bobby', email: `bob-${unique}@example.com`, pendingTasks: ['a'.repeat(24)]
  }), 404, 'reference to nonexistent task rejected');
  eqStatus(await api('PUT', '/api/users/not-an-id', {}), 404, 'invalid URL id => 404');
  eqStatus(await api('PUT', `/api/tasks/${'a'.repeat(24)}`, {}),
    404, 'nonexistent task => 404 before body validation');

  // A completed task may still be assigned. It is never in pendingTasks.
  r = await api('POST', '/api/tasks', {
    name: 'Completed task', deadline: '2026-12-02',
    completed: true, assignedUser: bobId
  });
  eqStatus(r, 201, 'create completed assigned task');
  const completedId = r.data._id;
  createdTasks.push(completedId);
  r = await api('GET', `/api/users/${bobId}`);
  assert.ok(!r.data.pendingTasks.includes(completedId));
  eqStatus(await api('PUT', `/api/users/${bobId}`, {
    name: 'Bobby', email: `bob-${unique}@example.com`, pendingTasks: [completedId]
  }), 400, 'completed tasks rejected from pendingTasks');

  // User-side assignment transfers an unfinished task from the old user.
  r = await api('PUT', `/api/users/${aliceId}`, {
    name: 'Ada', email: `ada-${unique}@example.com`, pendingTasks: [taskId]
  });
  eqStatus(r, 200, 'assign task by updating user');
  r = await api('GET', `/api/tasks/${taskId}`);
  assert.equal(r.data.assignedUser, aliceId);
  r = await api('GET', `/api/users/${aliceId}`);
  assert.ok(r.data.pendingTasks.includes(taskId));

  // Deleting a pending task clears its owner reference.
  eqStatus(await api('DELETE', `/api/tasks/${taskId}`), 204, 'delete assigned task');
  createdTasks.splice(createdTasks.indexOf(taskId), 1);
  r = await api('GET', `/api/users/${aliceId}`);
  assert.ok(!r.data.pendingTasks.includes(taskId));
  eqStatus(await api('GET', `/api/tasks/${taskId}`), 404, 'deleted task still fetchable');

  eqStatus(await api('DELETE', `/api/users/${bobId}`), 204, 'delete user');
  createdUsers.splice(createdUsers.indexOf(bobId), 1);
  r = await api('GET', `/api/tasks/${completedId}`);
  assert.equal(r.data.assignedUser, '', 'user deletion did not unassign completed task');

  console.log('PASS: creation, defaults, validation, filtering, projection, count,');
  console.log('      reassignment, completion, rename, error codes, and deletions.');
}

(async () => {
  try { await test(); }
  catch (e) { console.error('FAIL:', e.stack || e); process.exitCode = 1; }
  finally {
    for (const id of createdTasks) {
      try { await api('DELETE', `/api/tasks/${id}`); } catch (e) { console.error('Cleanup task:', e.message); }
    }
    for (const id of createdUsers) {
      try { await api('DELETE', `/api/users/${id}`); } catch (e) { console.error('Cleanup user:', e.message); }
    }
  }
})();
