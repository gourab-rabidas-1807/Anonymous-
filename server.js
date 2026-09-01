const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;


/*
  Temporary message storage.

  sessionId -> {
    telegramMessageId,
    replies: []
  }
*/

const conversations = new Map();


/*
  Website
*/

app.get("/", (req, res) => {

  res.sendFile(
    path.join(__dirname, "index.html")
  );

});


/*
  Visitor sends a message
*/

app.post("/message", async (req, res) => {

  const sessionId =
    String(req.body.sessionId || "").trim();

  const name =
    String(req.body.name || "Anonymous").trim();

  const message =
    String(req.body.message || "").trim();


  if (!sessionId || !message) {

    return res.status(400).json({
      success: false,
      error: "Message is incomplete"
    });

  }


  try {

    const telegramText =
`📩 New Anonymous Message

👤 Name: ${name || "Anonymous"}

💬 Message:
${message}

↩️ Reply to THIS Telegram message to reply to the sender.`;


    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {

        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({

          chat_id: CHAT_ID,

          text: telegramText

        })

      }
    );


    const data = await response.json();


    if (!response.ok || !data.ok) {

      console.error(data);

      return res.status(500).json({
        success: false,
        error: "Telegram delivery failed"
      });

    }


    const telegramMessageId =
      data.result.message_id;


    conversations.set(sessionId, {

      telegramMessageId:
        telegramMessageId,

      replies: []

    });


    res.json({
      success: true
    });


  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      error: "Server error"
    });

  }

});


/*
  Visitor checks for your replies
*/

app.get("/replies/:sessionId", (req, res) => {

  const sessionId =
    String(req.params.sessionId);


  const conversation =
    conversations.get(sessionId);


  if (!conversation) {

    return res.json({
      replies: []
    });

  }


  res.json({
    replies: conversation.replies
  });

});


/*
  Telegram update polling
*/

let lastUpdateId = 0;


async function checkTelegram() {

  try {

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=10&offset=${lastUpdateId + 1}`
    );


    const data = await response.json();


    if (!data.ok || !data.result) {
      return;
    }


    for (const update of data.result) {

      lastUpdateId = update.update_id;


      const message =
        update.message;


      if (!message) continue;


      /*
        We only process replies to messages
        previously sent by this server.
      */

      if (!message.reply_to_message) {
        continue;
      }


      const repliedToId =
        message.reply_to_message.message_id;


      for (const [sessionId, conversation]
        of conversations.entries()) {


        if (
          conversation.telegramMessageId
          === repliedToId
        ) {

          const replyText =
            String(message.text || "").trim();


          if (!replyText) continue;


          conversation.replies.push(
            replyText
          );


          /*
            Keep only the latest 20 replies.
          */

          if (conversation.replies.length > 20) {

            conversation.replies.shift();

          }


          console.log(
            "Reply delivered to session:",
            sessionId
          );

          break;

        }

      }

    }

  } catch (error) {

    console.error(
      "Telegram polling error:",
      error.message
    );

  }

}


/*
  Poll Telegram regularly.
*/

setInterval(
  checkTelegram,
  3000
);


/*
  Start server
*/

const PORT =
  process.env.PORT || 3000;


app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );

  checkTelegram();

});