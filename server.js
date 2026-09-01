const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));


// ==========================================
// TEMPORARY CONVERSATION STORAGE
// ==========================================

const conversations = new Map();


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
    String(req.body.name || "Anonymous").trim();

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


  // Create conversation if it doesn't exist

  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, []);
  }


  const conversation =
    conversations.get(sessionId);


  // ========================================
  // SAVE VISITOR MESSAGE FIRST
  // ========================================

  conversation.push({
    text: message,
    sender: "visitor",
    time: new Date().toISOString()
  });


  try {

    // ======================================
    // SEND MESSAGE TO TELEGRAM
    // ======================================

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
              "↩️ Reply to THIS Telegram message to reply to the sender.",

          })
        }
      );


    const telegramData =
      await telegramResponse.json();


    if (!telegramResponse.ok ||
        !telegramData.ok) {

      console.error(
        "Telegram error:",
        telegramData
      );

      return res.status(500).json({
        success: false,
        error: "Telegram delivery failed"
      });

    }


    // ======================================
    // SAVE TELEGRAM MESSAGE ID
    // ======================================

    const telegramMessageId =
      telegramData.result.message_id;


    conversation[conversation.length - 1]
      .telegramMessageId =
      telegramMessageId;


    // Save mapping for Telegram replies

    conversation.telegramMessageId =
      telegramMessageId;


    // ======================================
    // SUCCESS
    // ======================================

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

app.get("/conversation/:sessionId", (req, res) => {

  const sessionId =
    String(req.params.sessionId || "").trim();


  if (!sessionId) {

    return res.json({
      messages: []
    });

  }


  const conversation =
    conversations.get(sessionId) || [];


  // Remove internal mapping property

  const messages =
    conversation.filter(
      item =>
        item &&
        typeof item.text === "string"
    );


  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  res.json({
    messages
  });

});


// ==========================================
// TELEGRAM REPLY CHECKER
// ==========================================
//
// This checks Telegram for replies.
// When you reply to the Telegram message,
// the reply is sent back to the correct
// anonymous visitor.
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


      const message =
        update.message;


      if (!message) {
        continue;
      }


      // We only care about messages
      // that are replies.

      if (!message.reply_to_message) {
        continue;
      }


      const repliedToId =
        message.reply_to_message.message_id;


      // ====================================
      // FIND WHICH VISITOR SENT THAT MESSAGE
      // ====================================

      let foundSessionId = null;


      for (
        const [sessionId, conversation]
        of conversations.entries()
      ) {

        const found =
          conversation.some(
            item =>
              item.telegramMessageId ===
              repliedToId
          );


        if (found) {

          foundSessionId =
            sessionId;

          break;

        }

      }


      if (!foundSessionId) {
        continue;
      }


      const conversation =
        conversations.get(
          foundSessionId
        );


      // ====================================
      // SAVE GOURAB'S REPLY
      // ====================================

      conversation.push({

        text:
          String(
            message.text || ""
          ),

        sender:
          "owner",

        time:
          new Date(
            message.date * 1000
          ).toISOString()

      });


      console.log(
        "Owner reply received for session:",
        foundSessionId
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
// CHECK TELEGRAM EVERY 2 SECONDS
// ==========================================

setInterval(
  checkTelegramReplies,
  2000
);


// ==========================================
// SERVER
// ==========================================

const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);