require("dotenv").config();
var app = require("express")();
var bodyParser = require("body-parser");
var axios = require("axios");
var ethers = require("ethers");
app.use(bodyParser.json());

var { TELEGRAM_API_KEY, SERVER_URL, WEBHOOK_DEFENDER } = process.env;
console.log(TELEGRAM_API_KEY, SERVER_URL, WEBHOOK_DEFENDER);

var TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_API_KEY}`;
var URI = `/webhook/${TELEGRAM_API_KEY}`;

async function init() {
  var res = await axios.get(
    `${TELEGRAM_API}/setWebhook?url=${SERVER_URL + URI}`
  );
  console.log(res.data);
}

async function deleteMessage(chat_id, message_id) {
  try {
    await axios.post(`${TELEGRAM_API}/deleteMessage`, {
      chat_id,
      message_id,
    });
  } catch (error) {
    console.log("Error deleting message");
  }
}

async function sendMessage(chat_id, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id,
      text,
    });
  } catch (error) {
    console.log("Error sending message");
  }
}

app.post(URI, async (req, res) => {
  console.log(req.body);
  if (req && req.body && req.body.message) {
    var message = req.body.message;
    var messageId = message.message_id;
    var from = message.from.first_name;
    var chatId = message.chat.id;
    var text = message.text;

    if (!text.includes("/fund")) return res.send();
    var wallet = text.substring(text.indexOf("0x"));
    console.log(wallet);

    // validate address checksum
    await deleteMessage(chatId, messageId);
    try {
      wallet = ethers.utils.getAddress(wallet);
    } catch (error) {
      console.log(error.message);
      await sendMessage(chatId, `${from}, provide a valid address!`);
      return res.send();
    }

    // inform request to user
    await sendMessage(
      chatId,
      `${from}, en breve recibirás 500 BUSD. ¡Hasta pronto!`
    );

    // call defender
    var data = JSON.stringify({
      wallet,
      from,
      chatId,
    });

    var request = {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      data,
      url: WEBHOOK_DEFENDER,
    };
    var response = await axios(request);
    console.log(response.status);
  }

  return res && res.send && res.send();
});

app.get("/", (req, res) => {
  console.log("WORKGING");
  res.send("Working");
});

var port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log("App running at port:", port);
  await init();
});
