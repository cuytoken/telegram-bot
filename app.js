require("dotenv").config();
var app = require("express")();
var bodyParser = require("body-parser");
var axios = require("axios");
var ethers = require("ethers");
var {
  DefenderRelayProvider,
  DefenderRelaySigner,
} = require("defender-relay-client/lib/ethers");
app.use(bodyParser.json());

// Smart Contract connection
var credentials = {
  apiKey: process.env.RLYR_TLGRM_API_KEY,
  apiSecret: process.env.RLYR_TLGRM_SECRET_KEY,
};
var provider = new DefenderRelayProvider(credentials);
var signer = new DefenderRelaySigner(credentials, provider, {
  speed: "fast",
});
var gasLimit = { gasLimit: 3000000 };
var pcuyAddress = "0x914C617CB3A1C075F9116734A53FfbCF5CeD6CA9";
var pcuyAbi = ["function test_mint(address _account, uint256 _amount)"];
var pcuyContract = new ethers.Contract(pcuyAddress, pcuyAbi, signer);

// topic from event
var iface = new ethers.utils.Interface([
  "event HasReceivedPcuy(address account, bool hasReceived, uint256 balance)",
]);
var topic = iface.getEventTopic("HasReceivedPcuy");

// Telegram integratino
var { TELEGRAM_API_KEY, SERVER_URL, WEBHOOK_DEFENDER } = process.env;
var TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_API_KEY}`;
var URI = `/webhook/${TELEGRAM_API_KEY}`;

// Register URL in Telegram API
async function init() {
  var res = await axios.get(
    `${TELEGRAM_API}/setWebhook?url=${SERVER_URL + URI}`
  );
  console.log(res?.data);
}

function deleteMessage(chat_id, message_id) {
  try {
    axios.post(`${TELEGRAM_API}/deleteMessage`, {
      chat_id,
      message_id,
    });
  } catch (error) {
    console.log("Error deleting message");
  }
}

function sendMessage(chat_id, text) {
  try {
    axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id,
      text,
    });
  } catch (error) {
    console.log("Error sending message");
  }
}

app.post(URI, async (req, res) => {
  if (req && req.body && req.body.message) {
    var message = req.body.message;
    var messageId = message.message_id;
    var from = message.from.first_name;
    var chatId = message.chat.id;
    var text = message.text;

    if (!text) return res.send();
    if (!text.includes("/fund")) return res.send();
    var wallet = text.substring(text.indexOf("0x"));

    // validate address checksum
    deleteMessage(chatId, messageId);
    try {
      wallet = ethers.utils.getAddress(wallet);
    } catch (error) {
      console.log(error.message);
      sendMessage(chatId, `${from}, provide a valid address!`);
      return res.send();
    }

    // inform request to user
    sendMessage(chatId, `${from}, estamos procesando su pedido.`);

    // call smart contract
    var tx = await pcuyContract
      .connect(signer)
      .test_mint(wallet, "5325000000000000000000");
    var response = await tx.wait(1);

    var data;
    for (var ev of response.events) {
      if (ev.topics.includes(topic)) {
        data = ev.data;
      }
    }

    var [account, hasReceived, balance] = iface.decodeFunctionData(
      "test_mint",
      data
    );

    var message = "";
    var maticBalance = ethers.utils.parseEther("0.025");
    var bal = (await provider.getBalance(wallet)).toString();
    if (bal == 0) {
      message += "Se envió 0.025 MATIC. ";
      var tx = await signer.sendTransaction({
        to: wallet,
        value: maticBalance,
      });
      await tx.wait();
    }

    if (hasReceived) {
      sendMessage(chatId, `¡${from}, MATIC: ${bal}, PCUY: ${balance}!`);
    } else {
      message += "Se envió 5375 PCUY tokens.";
      sendMessage(chatId, `¡${from}, ${message}!`);
    }
    return res && res.send && res.send();
  }
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
