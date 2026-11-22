
const SESSION_TTL = 900; // 15 minutes
const SESSION_PREFIX = "session:";

function getStore(env) {
  const store = env?.MEDIASAVER_SESSIONS;

  if (
    !store ||
    typeof store.get !== "function" ||
    typeof store.put !== "function" ||
    typeof store.delete !== "function"
  ) {
    throw new Error(
      "MediaSaver session storage is not configured."
    );
  }

  return store;
}

function validSessionId(id) {
  return (
    typeof id === "string" &&
    /^[0-9a-f-]{36}$/i.test(id)
  );
}

function sessionKey(id) {
  return SESSION_PREFIX + id;
}

export async function createSession(env) {
  const store = getStore(env);

  const id = crypto.randomUUID();

  const session = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL * 1000,
    cookies: {},
    metadata: {}
  };

  await store.put(
    sessionKey(id),
    JSON.stringify(session),
    {
      expirationTtl: SESSION_TTL
    }
  );

  return {
    id,
    expiresAt: session.expiresAt
  };
}

export async function getSession(env, id) {
  const store = getStore(env);

  if (!validSessionId(id)) {
    return null;
  }

  const raw = await store.get(sessionKey(id));

  if (!raw) {
    return null;
  }

  let session;

  try {
    session = JSON.parse(raw);
  } catch {
    await store.delete(sessionKey(id));
    return null;
  }

  if (
    !session ||
    session.expiresAt <= Date.now()
  ) {
    await store.delete(sessionKey(id));
    return null;
  }

  return session;
}

export async function updateSession(
  env,
  id,
  updates = {}
) {
  const store = getStore(env);

  const current = await getSession(env, id);

  if (!current) {
    throw new Error(
      "Session expired or not found."
    );
  }

  const updated = {
    ...current,
    cookies: {
      ...current.cookies,
      ...(updates.cookies || {})
    },
    metadata: {
      ...current.metadata,
      ...(updates.metadata || {})
    },
    updatedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL * 1000
  };

  await store.put(
    sessionKey(id),
    JSON.stringify(updated),
    {
      expirationTtl: SESSION_TTL
    }
  );

  return {
    id: updated.id,
    expiresAt: updated.expiresAt
  };
}

export async function deleteSession(env, id) {
  const store = getStore(env);

  if (!validSessionId(id)) {
    return false;
  }

  await store.delete(sessionKey(id));

  return true;
}
