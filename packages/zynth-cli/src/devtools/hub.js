const http = require("http");
const { WebSocketServer } = require("ws");

function createDevtoolsHub({
  host = "0.0.0.0",
  port = 8091,
  print = true,
  json = false,
  filters = {},
  replayLimit = 200,
} = {}) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const topicsToClients = new Map();
  const clientsToTopics = new Map();
  const history = [];

  function ensureClientTopics(client) {
    let topics = clientsToTopics.get(client);
    if (!topics) {
      topics = new Set();
      clientsToTopics.set(client, topics);
    }
    return topics;
  }

  function ensureTopicClients(topic) {
    let clients = topicsToClients.get(topic);
    if (!clients) {
      clients = new Set();
      topicsToClients.set(topic, clients);
    }
    return clients;
  }

  function subscribe(client, topic) {
    ensureClientTopics(client).add(topic);
    ensureTopicClients(topic).add(client);
  }

  function unsubscribe(client, topic) {
    const topics = clientsToTopics.get(client);
    if (topics) {
      topics.delete(topic);
    }
    const clients = topicsToClients.get(topic);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        topicsToClients.delete(topic);
      }
    }
  }

  function matchesTopic(subscription, topic) {
    if (subscription === topic) return true;
    if (subscription.endsWith("*")) {
      const prefix = subscription.slice(0, -1);
      return topic.startsWith(prefix);
    }
    return false;
  }

  function fanout(topic, payload) {
    for (const [subscription, clients] of topicsToClients.entries()) {
      if (!matchesTopic(subscription, topic)) continue;
      for (const client of clients) {
        if (client.readyState === client.OPEN) {
          client.send(payload);
        }
      }
    }
  }

  function shouldPrintEvent(event) {
    if (!print) return false;
    if (filters.hideAutomation) {
      const topic = String(event.topic || "");
      if (topic.startsWith("automation/")) return false;
    }
    if (filters.hideDebug) {
      const level = String(event.level || "").toLowerCase();
      if (level === "debug") return false;
    }
    if (filters.topics && filters.topics.length > 0) {
      const topic = String(event.topic || "");
      const match = filters.topics.some((entry) => matchesTopic(entry, topic));
      if (!match) return false;
    }
    if (filters.levels && filters.levels.length > 0) {
      const level = String(event.level || "").toLowerCase();
      if (!filters.levels.includes(level)) return false;
    }
    if (filters.tags && filters.tags.length > 0) {
      const tag = String(event.tag || "");
      if (!filters.tags.includes(tag)) return false;
    }
    return true;
  }

  function logEvent(event) {
    if (!shouldPrintEvent(event)) return;
    if (json) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
      return;
    }
    const data = event.data;
    const dataIsObject = data && typeof data === "object";
    const dataMessage =
      dataIsObject && typeof data.message === "string" ? data.message : null;
    const dataStack =
      dataIsObject && typeof data.stack === "string" ? data.stack : null;
    const dataContext =
      dataIsObject && typeof data.context === "string" ? data.context : null;
    const dataRuntime =
      dataIsObject && typeof data.runtime === "string" ? data.runtime : null;
    const level = event.level ? String(event.level).toUpperCase() : "LOG";
    const tag = event.tag ? String(event.tag) : "devtools";
    const topic = event.topic ? String(event.topic) : "unknown";
    let message;
    if (dataMessage) {
      const contextSuffix = dataContext ? ` (${dataContext})` : "";
      const stackSuffix = dataStack ? `\n${dataStack}` : "";
      message = `${dataMessage}${contextSuffix}${stackSuffix}`;
    } else if (typeof data === "string") {
      message = data;
    } else if (dataIsObject) {
      try {
        message = JSON.stringify(data);
      } catch {
        message = String(data);
      }
    } else {
      message = String(data ?? "");
    }
    const ts = event.ts ? new Date(event.ts).toISOString() : "";
    const prefix = ts ? `[${ts}]` : "";
    const styledLevel = formatLevel(level);
    if (topic === "log/console" || tag === "console") {
      const parts = [];
      if (prefix) parts.push(prefix);
      parts.push(styledLevel, message);
      process.stdout.write(`${parts.join(" ")}\n`);
      return;
    }
    if (topic === "log/ios" || tag === "ios" || topic === "log/android" || tag === "android") {
      const parts = [];
      if (prefix) parts.push(prefix);
      parts.push(styledLevel, message);
      process.stdout.write(`${parts.join(" ")}\n`);
      return;
    }
    const parts = [];
    if (prefix) parts.push(prefix);
    parts.push(styledLevel, tag, topic, message);
    process.stdout.write(`${parts.join(" ")}\n`);
  }

  function recordEvent(event) {
    if (replayLimit <= 0) return;
    history.push(event);
    if (history.length > replayLimit) {
      history.shift();
    }
  }

  function publish(event) {
    const topic = event?.topic;
    if (typeof topic !== "string") return;
    const payload = JSON.stringify({
      type: "event",
      event,
    });
    recordEvent(event);
    fanout(topic, payload);
    logEvent(event);
  }

  function replayEvents(client, subscription, limit) {
    if (history.length === 0) return;
    const sliceLimit =
      typeof limit === "number" && limit > 0 ? limit : history.length;
    const matches = [];
    for (
      let i = history.length - 1;
      i >= 0 && matches.length < sliceLimit;
      i -= 1
    ) {
      const event = history[i];
      if (matchesTopic(subscription, String(event.topic || ""))) {
        matches.push(event);
      }
    }
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      client.send(JSON.stringify({ type: "event", event: matches[i] }));
    }
  }

  wss.on("connection", (client) => {
    client.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      switch (message.type) {
        case "sub": {
          const topics = Array.isArray(message.topics)
            ? message.topics
            : [message.topic].filter(Boolean);
          const replay = Boolean(message.replay);
          const limit =
            typeof message.limit === "number" ? message.limit : undefined;
          for (const topic of topics) {
            if (typeof topic === "string") {
              subscribe(client, topic);
              if (replay) {
                replayEvents(client, topic, limit);
              }
            }
          }
          break;
        }
        case "unsub": {
          const topics = Array.isArray(message.topics)
            ? message.topics
            : [message.topic].filter(Boolean);
          for (const topic of topics) {
            if (typeof topic === "string") unsubscribe(client, topic);
          }
          break;
        }
        case "pub": {
          const event = message.event || {};
          const topic = event.topic || message.topic;
          if (typeof topic !== "string") return;
          publish({ ...event, topic });
          break;
        }
        case "ping": {
          client.send(JSON.stringify({ type: "pong", ts: Date.now() }));
          break;
        }
        default:
          break;
      }
    });

    client.on("close", () => {
      const topics = clientsToTopics.get(client);
      if (!topics) return;
      for (const topic of topics) {
        unsubscribe(client, topic);
      }
      clientsToTopics.delete(client);
    });
  });

  function start() {
    return new Promise((resolve) => {
      server.listen(port, host, () => {
        resolve({
          host,
          port,
          close: () =>
            new Promise((closeResolve) => {
              wss.close(() => {
                server.close(() => closeResolve());
              });
            }),
        });
      });
    });
  }

  return { start, publish };
}

function formatLevel(level) {
  switch (level) {
    case "ERROR":
      return styleLevel(` ${level} `, 41);
    case "WARN":
      return styleLevel(` ${level} `, 43);
    case "INFO":
      return styleLevel(" INF ", 44);
    case "DEBUG":
      return styleLevel(` ${level} `, 45);
    case "LOG":
    default:
      return styleLevel(` ${level} `, 107, 30);
  }
}

function styleLevel(text, bgCode, fgCode = 37) {
  return `\u001b[${fgCode}m\u001b[${bgCode}m\u001b[1m${text}\u001b[0m`;
}

module.exports = { createDevtoolsHub };
