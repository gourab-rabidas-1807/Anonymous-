const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// DATABASE
// ==========================================

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing!");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : false
});

// ==========================================
// CREATE DATABASE TABLES
// ==========================================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      session_id TEXT PRIMARY KEY,
      visitor_name TEXT DEFAULT 'Anonymous',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL
        REFERENCES conversations(session_id)
        ON DELETE CASCADE,
      text TEXT NOT NULL,
      sender TEXT NOT NULL,
      time TIMESTAMPTZ DEFAULT NOW(),
      telegram_message_id BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session
      ON messages(session_id);

    CREATE INDEX IF NOT EXISTS idx_messages_telegram
      ON messages(telegram_message_id);

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  console.log("Database initialized successfully.");
}

// ==========================================
// HOME PAGE
// ==========================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ==========================================
// SEND MESSAGE FROM WEBSITE
// ==========================================

app.post("/message", async (req, res) => {
  const sessionId =
    String(req.body.sessionId || "").trim();

  const name =
    String(req.body.name || "Anonymous").trim() ||
    "Anonymous";

  const message =
    String(req.body.message || "").trim();

  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: "Session ID is missing"
    });
  }

  if (!message) {
    return res.status(400).json({
      success: false,
      error: "Message is empty"
    });
  }

  try {
    // --------------------------------------
    // CREATE / UPDATE CONVERSATION
    // --------------------------------------

    await pool.query(
      `
      INSERT INTO conversations
        (session_id, visitor_name)
      VALUES
        ($1, $2)
      ON CONFLICT (session_id)
      DO UPDATE SET
        visitor_name = EXCLUDED.visitor_name,
        updated_at = NOW()
      `,
      [sessionId, name]
    );

    // --------------------------------------
    // SAVE VISITOR MESSAGE
    // --------------------------------------

    const result = await pool.query(
      `
      INSERT INTO messages
        (session_id, text, sender)
      VALUES
        ($1, $2, 'visitor')
      RETURNING id, time
      `,
      [sessionId, message]
    );

    const messageId = result.rows[0].id;

    // --------------------------------------
    // SEND TO TELEGRAM
    // --------------------------------------

    const telegramResponse =
      await fetch(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chat_id: process.env.CHAT_ID,
            text:
              "📩 New Anonymous Message\n\n" +
              "👤 Name: " +
              name +
              "\n\n" +
              "💬 Message:\n" +
              message +
              "\n\n" +
              "↩️ Reply to THIS Telegram message to reply to the sender."
          })
        }
      );

    const telegramData =
      await telegramResponse.json();

    if (
      !telegramResponse.ok ||
      !telegramData.ok
    ) {
      console.error(
        "Telegram error:",
        telegramData
      );

      return res.status(500).json({
        success: false,
        error: "Telegram delivery failed"
      });
    }

    // --------------------------------------
    // SAVE TELEGRAM MESSAGE ID
    // --------------------------------------

    const telegramMessageId =
      telegramData.result.message_id;

    await pool.query(
      `
      UPDATE messages
      SET telegram_message_id = $1
      WHERE id = $2
      `,
      [
        telegramMessageId,
        messageId
      ]
    );

    await pool.query(
      `
      UPDATE conversations
      SET updated_at = NOW()
      WHERE session_id = $1
      `,
      [sessionId]
    );

    res.json({
      success: true
    });

  } catch (error) {
    console.error(
      "Server error:",
      error
    );

    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// ==========================================
// GET CONVERSATION
// ==========================================

app.get(
  "/conversation/:sessionId",
  async (req, res) => {

    const sessionId =
      String(
        req.params.sessionId || ""
      ).trim();

    if (!sessionId) {
      return res.json({
        messages: []
      });
    }

    try {
      const result =
        await pool.query(
          `
          SELECT
            text,
            sender,
            time
          FROM messages
          WHERE session_id = $1
          ORDER BY time ASC, id ASC
          `,
          [sessionId]
        );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      res.json({
        messages: result.rows
      });

    } catch (error) {
      console.error(
        "Conversation error:",
        error
      );

      res.status(500).json({
        messages: []
      });
    }
  }
);

// ==========================================
// TELEGRAM OFFSET
// ==========================================

async function getTelegramOffset() {
  const result =
    await pool.query(
      `
      SELECT value
      FROM app_state
      WHERE key = 'telegram_offset'
      `
    );

  if (result.rows.length === 0) {
    return 0;
  }

  return Number(result.rows[0].value) || 0;
}

async function saveTelegramOffset(offset) {
  await pool.query(
    `
    INSERT INTO app_state
      (key, value)
    VALUES
      ('telegram_offset', $1)
    ON CONFLICT (key)
    DO UPDATE SET
      value = EXCLUDED.value
    `,
    [String(offset)]
  );
}

// ==========================================
// TELEGRAM REPLY CHECKER
// ==========================================

let telegramOffset = 0;

async function checkTelegramReplies() {
  if (!process.env.BOT_TOKEN) {
    return;
  }

  try {
    const response =
      await fetch(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=5`
      );

    const data =
      await response.json();

    if (!data.ok) {
      console.error(
        "Telegram getUpdates error:",
        data
      );
      return;
    }

    for (const update of data.result) {

      telegramOffset =
        update.update_id + 1;

      // Save offset immediately so
      // old Telegram updates aren't
      // repeatedly processed after restart.
      await saveTelegramOffset(
        telegramOffset
      );

      const message =
        update.message;

      if (!message) {
        continue;
      }

      // Only accept messages from
      // the owner's Telegram chat.
      if (
        String(message.chat?.id) !==
        String(process.env.CHAT_ID)
      ) {
        continue;
      }

      // We only care about replies.
      if (!message.reply_to_message) {
        continue;
      }

      const repliedToId =
        message.reply_to_message.message_id;

      // --------------------------------------
      // FIND ORIGINAL WEBSITE MESSAGE
      // --------------------------------------

      const original =
        await pool.query(
          `
          SELECT session_id
          FROM messages
          WHERE telegram_message_id = $1
          LIMIT 1
          `,
          [repliedToId]
        );

      if (original.rows.length === 0) {
        continue;
      }

      const sessionId =
        original.rows[0].session_id;

      const replyText =
        String(
          message.text || ""
        ).trim();

      if (!replyText) {
        continue;
      }

      // --------------------------------------
      // SAVE OWNER REPLY
      // --------------------------------------

      await pool.query(
        `
        INSERT INTO messages
          (session_id, text, sender, time)
        VALUES
          ($1, $2, 'owner', $3)
        `,
        [
          sessionId,
          replyText,
          new Date(
            message.date * 1000
          )
        ]
      );

      await pool.query(
        `
        UPDATE conversations
        SET updated_at = NOW()
        WHERE session_id = $1
        `,
        [sessionId]
      );

      console.log(
        "Owner reply saved for session:",
        sessionId
      );
    }

  } catch (error) {
    console.error(
      "Telegram polling error:",
      error
    );
  }
}

// ==========================================
// START SERVER
// ==========================================

const PORT =
  process.env.PORT || 3000;

async function startServer() {
  try {
    await initDatabase();

    telegramOffset =
      await getTelegramOffset();

    console.log(
      "Telegram offset:",
      telegramOffset
    );

    app.listen(
      PORT,
      () => {
        console.log(
          `Server running on port ${PORT}`
        );
      }
    );

    // Check Telegram every 2 seconds.
    setInterval(
      checkTelegramReplies,
      2000
    );

  } catch (error) {
    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
}

startServer();