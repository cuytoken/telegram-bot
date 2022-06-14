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
var pcuyAddress = "0x26813E464DA80707B7F24bf19e08Bf876F0f3388";
var pcuyAbi = [
  "function test_mint(address _account, uint256 _amount)",
  "event HasReceivedPcuy(address account, bool hasReceived, uint256 balance)",
];
var pcuyContract = new ethers.Contract(pcuyAddress, pcuyAbi, signer);
var pcuyQ = ethers.utils.parseEther("5375");
var maticBalance = ethers.utils.parseEther("0.025");

// topic from event
var iface = new ethers.utils.Interface([
  "event HasReceivedPcuy(address account, bool hasReceived, uint256 balance)",
]);
var topic = iface.getEventTopic("HasReceivedPcuy");

// Telegram integratino
var { TELEGRAM_API_KEY, SERVER_URL } = process.env;
var TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_API_KEY}`;
var URI = `/webhook/${TELEGRAM_API_KEY}`;

// Register URL in Telegram API
async function init() {
  var endpoint = `${TELEGRAM_API}/setWebhook?url=${SERVER_URL + URI}`;
  var res = await axios.get(endpoint);
  console.log(res && res.data);
}

async function deleteMessage(chat_id, message_id, res) {
  try {
    await axios.post(`${TELEGRAM_API}/deleteMessage`, {
      chat_id,
      message_id,
    });
    return false;
  } catch (error) {
    console.log("Error deleting message", chat_id, message_id);
    res.send();
    return true;
  }
}

async function sendMessage(chat_id, text, res) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id,
      text,
    });
    return false;
  } catch (error) {
    console.log("Error sending message");
    res.send();
    return true;
  }
}

async function test_mint(wallet) {
  var tx;
  var response;
  try {
    tx = await pcuyContract
      .connect(signer)
      .test_mint(wallet, pcuyQ, { gasLimit: 1000000 });
    response = await tx.wait(1);
  } catch (error) {
    return [true, null, null, null];
  }
  var data;
  for (var ev of response.events) {
    if (ev.topics.includes(topic)) {
      data = ev.data;
    }
  }

  if (!data) return [true, null, null, null];
  var [account, hasReceived, balance] = ethers.utils.defaultAbiCoder.decode(
    ["address", "bool", "uint256"],
    data
  );

  return [false, account, hasReceived, balance];
}

async function sendMatic(wallet) {
  var msg = "";
  var bal = (await provider.getBalance(wallet)).toString();
  if (bal == String(0)) {
    msg = "Se envió 0.025 MATIC. ";
    try {
      var tx = await signer.sendTransaction({
        to: wallet,
        value: maticBalance,
        gasLimit: 1000000,
      });
      await tx.wait();
      return [false, msg, bal];
    } catch (error) {
      console.log("error sending matic", wallet, maticBalance);
      return [true, msg, bal];
    }
  }
  return [false, msg, bal];
}

function validateAddress(wallet) {
  try {
    wallet = ethers.utils.getAddress(wallet);
    return [false, wallet];
  } catch (error) {
    console.log("Wrong wallet address", wallet, error.message);
    return [true, null];
  }
}

app.post(URI, async (req, res) => {
  console.log("POST AT", URI, "with message", req && req.body);
  if (!(req && req.body && req.body.message)) return res.send();
  var message = req.body.message;
  var messageId = message.message_id;
  var from = message.from.first_name;
  var chatId = message.chat.id;
  var text = message.text;
  console.log("Has message", messageId, from, chatId, text);

  if (!text) {
    console.log("Empty text", text);
    return res.send();
  }

  if (!text.includes("/fund")) {
    console.log("Text with no /fund", text);
    return res.send();
  }

  var wallet = text.substring(text.indexOf("0x"));
  var walletSummary = "0x..." + wallet.substr(-5);

  // validate address checksum
  var error = await deleteMessage(chatId, messageId, res);
  if (error) return;

  var [error, wallet] = validateAddress(wallet);
  if (error) {
    sendMessage(chatId, `${from}, provide a valid address!`, res);
    return res && res.send && res.send();
  }
  console.log("wallet", wallet);

  // inform request to user
  var message = `${from}, estamos procesando su pedido ${walletSummary}.`;
  var error = await sendMessage(chatId, message, res);
  if (error) return;

  var [error, account, hasReceived, balance] = await test_mint(wallet);
  if (error) res && res.send && res.send();

  var message = "";
  var [error, msg, bal] = await sendMatic(wallet);
  if (error) res && res.send && res.send();
  message += msg;

  if (hasReceived) {
    message = `¡${from}, MATIC: ${bal}, PCUY: ${balance} (${walletSummary})!`;
  } else {
    message += "Se envió 5375 PCUY tokens";
    message = `¡${from}, ${message} (${walletSummary})!`;
  }

  var error = await sendMessage(chatId, message, res);
  if (error) return;

  return res && res.send && res.send();
});

app.get("/", (req, res) => {
  console.log("WORKGING");
  res.send("Working");
});

var port = process.env.PORT || 5000;
app.listen(port, async () => {
  console.log("App running at portt:", port);
  await init();
});

var { Client, Intents } = require("discord.js"); //import discord.js
var client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.DIRECT_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGES,
  ],
}); //create new client

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on("messageCreate", async (message) => {
  var { channelId, id, author, content } = message;
  var from = author;

  // validate channel and command
  if (channelId != "985656816912461865") return;
  if (!content.includes("/fund")) return;

  // get wallet
  var wallet = content.substring(content.indexOf("0x"));
  var walletSummary = "0x..." + wallet.substr(-5);

  // delete message
  // message.delete();

  // validate wallet
  var [error, wallet] = validateAddress(wallet);
  if (error) {
    var msg = `¡${from}, prueba con otra wallet!`;
    message.channel.send({ content: msg });
    return;
  }
  console.log("wallet", wallet);

  // in process
  var msg = `${from}, estamos procesando su pedido ${walletSummary}.`;
  message.channel.send({ content: msg });

  // mint
  var [error, account, hasReceived, balance] = await test_mint(wallet);
  if (error) {
    var msg = `¡${from}, intente otra vez!`;
    message.channel.send({ content: msg });
    return;
  }

  var msg = "";
  var [error, m, bal] = await sendMatic(wallet);
  if (error) {
    var content = `¡${from}, intente otra vez!`;
    message.channel.send({ content });
    return;
  }
  msg += m;

  if (hasReceived) {
    msg = `¡${from}, MATIC: ${bal}, PCUY: ${balance} (${walletSummary})!`;
  } else {
    msg += "Se envió 5375 PCUY tokens";
    msg = `¡${from}, ${msg} (${walletSummary})!`;
  }
  message.channel.send({ content: msg });
});

client.login(process.env.CLIENT_TOKEN_DISCORD); //login bot using token
