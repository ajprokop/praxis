// https://dtsc.solutions/axp/

const express = require("express");
const https = require("https");
const cors = require("cors");
const fs = require("fs");
const axios = require("axios");
var CronJob = require("cron").CronJob;
const socket = require("socket.io");

const CCAAS_ACCOUNT = "xxxx";
const CCAAS_ID = "xxxx";
const CCAAS_SECRET = "xxxx";
const CONVERSATION_STRING = "Something";

var token;

const BASE_URL = "https://na.cc.avayacloud.com/";
const CCAAS_AUTH = `auth/realms/${CCAAS_ACCOUNT}/protocol/openid-connect/token`;
const CCAAS_CREATE_SESSION = `api/digital/channel/v1beta/accounts/${CCAAS_ACCOUNT}/sessions`;
const CCAAS_CREATE_ENGAGEMENT = `api/digital/channel/v1beta/accounts/${CCAAS_ACCOUNT}/engagements`;
const CCAAS_LIST_NOTIFICATION_SUBSCRIPTION = `api/notification/v1beta/accounts/${CCAAS_ACCOUNT}/subscriptions`;
const CCAAS_CREATE_NOTIFICATION_WEBHOOK = `api/notification/v1beta/accounts/${CCAAS_ACCOUNT}/subscriptions`;
const CCAAS_LIST_DIGITAL_SUBSCRIPTION = `api/digital/webhook/v1beta/accounts/${CCAAS_ACCOUNT}/subscriptions`;
const CCAAS_CREATE_DIGITAL_WEBHOOK = `api/digital/webhook/v1beta/accounts/${CCAAS_ACCOUNT}/subscriptions`;
const CHAIN_FILE = "/etc/letsencrypt/live/cxi-development.com/fullchain.pem";
const KEY_FILE = "/etc/letsencrypt/live/cxi-development.com/privkey.pem";

const URL_PORT = 3101;
const HOST = "https://cxi-development.com";
const NOTIFICATION_URL = HOST + ":" + URL_PORT.toString() + "/notificationWebhook/";
const DIGITAL_URL = HOST + ":" + URL_PORT.toString() + "/digitalWebhook/";
var key = fs.readFileSync(KEY_FILE).toString();
var cert = fs.readFileSync(CHAIN_FILE).toString();

var httpsOptions = {
    key: key,
    cert: cert,
};

var app = express();
app.use(express.json());
app.use(cors());

//Create the server and tell it to listen to the given port
var httpsServer = https.createServer(httpsOptions, app);

httpsServer.listen(URL_PORT, function() {
    console.log("Listening: ", URL_PORT.toString());
});

let clientMap = new Map();  // Key = phone number, value = socket
let socketMap = new Map();  // Key = socket Id, value = phone number

const sio = socket(httpsServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
});

sio.on("connection", function(socket) {
	socket.on('SUBSCRIBE', function(data) {
		if (!clientMap.has(data.phoneNumber)) {
			clientMap.set(data.phoneNumber, socket);
            socketMap.set(socket.id, data.phoneNumber);
		}
	});
	socket.on('UNSUBSCRIBE', function(data) {
		if (clientMap.has(data.phoneNumber)) {
			clientMap.delete(data.phoneNumber);
            socketMap.delete(socket.id);
		}
	});
	socket.on('disconnect', function(data) {
		var phoneNumber = socketMap.get(socket.id);
        clientMap.delete(phoneNumber);
        socketMap.delete(socket.id);
	});
});

// Every 10 minutes
var job = new CronJob(
    "*/10 * * * *",
    function() {
        refreshTokens();
    },
    null,
    false
);

async function refreshTokens() {
    const data = `grant_type=client_credentials&client_id=${CCAAS_ID}&client_secret=${CCAAS_SECRET}`;
	var options = {
		'method': 'post',
        'data': data,
		'url': `${BASE_URL}${CCAAS_AUTH}`,
		'headers': {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'Axios 1.1.3'
		}
	};

	try {
		const authResponse = await axios(options);
        console.dir(authResponse.data);
        token = authResponse.data.access_token;
        console.log("Token: " + token);
        await listDeleteNotificationSubscriptions();
        await createNotificationWebhook();
        console.log("**************************");
        await listDeleteDigitalSubscriptions();
        console.log("**************************");
        await createDigitalWebhook();
	} catch (e) {
		console.log(`Exception : ${e}`);
	}
}

runCCaaSChat();

async function runCCaaSChat() {
    await getToken();
}

app.post('/sendChatMsg/', function(req, res) {
    console.log(req.body);
    sendMessage(res, req.body.message, req.body.engagementId, req.body.sessionId, req.body.dialogId, req.body.correlationId, req.body.senderName);
});

app.post('/connect/', function(req, res) {
    console.log(req.body);
    connectToAXP(res, req.body.phone);
});

app.post('/deleteSession/', function(req, res) {
    console.log(req.body);
    deleteSession(res, req.body.sessionId);
});

app.post('/disconnectEngagement/', function(req, res) {
    console.log(req.body);
    disconnectEngagement(res, req.body.sessionId, req.body.engagementId, req.body.dialogId);
});

app.post('/notificationWebhook/', function(req, res) {
    console.log("*********** Notification Webhook *****************");
    console.dir(req.body, { depth: null });
    res.sendStatus(200);
});

app.post('/digitalWebhook/', function(req, res) {
    console.log("*********** Digital Webhook *****************");
    console.dir(req.body, { depth: null });
    var jsonObj = req.body;
    if (jsonObj.eventType == "MESSAGES") {
        var socketData = {
            prompt: "",
            type: "USER"
        }
        if (jsonObj.senderParticipantType == "AGENT") {
            socketData.type = "AGENT";        
        } 
        socketData.prompt = `${jsonObj.senderParticipantName}: ${jsonObj.body.elementText.text}`;
        var socket = clientMap.get(jsonObj.recipientParticipants[0].displayName);
        if (socket != null) {
            socket.emit("RECEIVE_PROMPT", socketData);
        }
    } else if (jsonObj.eventType == "PARTICIPANT_DISCONNECTED") {
        var socket = clientMap.get(jsonObj.displayName);
        if (socket != null) {
            socket.emit("DISCONNECTED", socketData);
        }
    }
    res.sendStatus(200);
});

async function connectToAXP(res, user) {
    const body = {
        customerIdentifiers: {
             chatName: [
                  user
             ]
        },
        channelProviderId: "chat",
        displayName: user
   }

	var options = {
		method: 'post',
        data: JSON.stringify(body),
		url: `${BASE_URL}${CCAAS_CREATE_SESSION}`,
		headers: {
			'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Axios 1.1.3'
		}
	};

	try {
		const createSessionResponse = await axios(options);
        console.log(JSON.stringify(createSessionResponse.data));
        const body = {
            sessionId: createSessionResponse.data.sessionId,
            channelId: "chat",
            conversation: CONVERSATION_STRING
       }
    
        var options = {
            method: 'post',
            data: JSON.stringify(body),
            url: `${BASE_URL}${CCAAS_CREATE_ENGAGEMENT}`,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Axios 1.1.3'
            }
        };   
        try {
            const createEngagementResponse = await axios(options);
            console.log(JSON.stringify(createEngagementResponse.data));
            var returnVal = {
                sessionId: createSessionResponse.data.sessionId,
                engagementId: createEngagementResponse.data.engagementId,
                dialogId: createEngagementResponse.data.dialogs[0].dialogId
            };
            res.status(200);
            res.send(JSON.stringify(returnVal))
        } catch (e) {
            console.log(`Exception : ${e}`);
            res.sendStatus(400);
        }  
	} catch (e) {
		console.log(`Exception : ${e}`);
        res.sendStatus(400);
	}   
}

async function getToken() {
    const data = `grant_type=client_credentials&client_id=${CCAAS_ID}&client_secret=${CCAAS_SECRET}`;
	var options = {
		'method': 'post',
        'data': data,
		'url': `${BASE_URL}${CCAAS_AUTH}`,
		'headers': {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'Axios 1.1.3'
		}
	};
	try {
		const authResponse = await axios(options);
        console.dir(authResponse.data);
        token = authResponse.data.access_token;
        console.log("Token: " + token);
        await listDeleteNotificationSubscriptions();
        await createNotificationWebhook();
        console.log("**************************");
        await listDeleteDigitalSubscriptions();
        console.log("**************************");
        await createDigitalWebhook();
        job.start();
	} catch (e) {
		console.log(`Exception : ${e}`);
	}
}

async function deleteSession(res, sessionId) {
    console.log(`${BASE_URL}${CCAAS_CREATE_SESSION}/${sessionId}?reason=USER_CLOSED`);
	var options = {
		method: 'delete',
		url: `${BASE_URL}${CCAAS_CREATE_SESSION}/${sessionId}?reason=USER_CLOSED`,
		headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Axios 1.1.3'
		}
	};
	try {
		const deleteSessionResponse = await axios(options);
        res.sendStatus(200);
	} catch (e) {
		console.log(`Exception : ${e}`);
        res.sendStatus(400);
	}   
}

async function disconnectEngagement(res, sessionId, engagementId, dialogId) {
    const body = {
        sessionId: sessionId,
        dialogId: dialogId,
        reason: "USER_CLOSED"
   }
	var options = {
		method: 'post',
        data: JSON.stringify(body),
		url: `${BASE_URL}${CCAAS_CREATE_ENGAGEMENT}/${engagementId}:disconnect/`,
		headers: {
			'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Axios 1.1.3'
		}
	};

	try {
		const disconnectEngagementResponse = await axios(options);
        res.sendStatus(200);
	} catch (e) {
		console.log(`Exception : ${e}`);
        res.sendStatus(400);
	}   
}

async function sendMessage(res, message, engagementId, sessionId, dialogId, correlationId, senderName) {
    const CCAAS_SEND_MESSAGE = `api/digital/channel/v1beta/accounts/${CCAAS_ACCOUNT}/engagements/${engagementId}/messages`;
    const body = {
        body: {
            elementText: {
                 text: message,
                 "textFormat": "PLAINTEXT"
            },
            elementType: "text"
       },
       sessionId: sessionId,
       dialogId: dialogId,
       correlationId: correlationId,
       senderParticipantName: senderName
   }

	var options = {
		method: 'post',
        data: JSON.stringify(body),
		url: `${BASE_URL}${CCAAS_SEND_MESSAGE}`,
		headers: {
			'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Axios 1.1.3'
		}
	};

	try {
		const sendMessageResponse = await axios(options);
        console.log(JSON.stringify(sendMessageResponse.data));
        res.sendStatus(200);
	} catch (e) {
		console.log(`Exception : ${e}`);
        res.sendStatus(200);
	}   
}

async function listDeleteNotificationSubscriptions() {
	var options = {
		'method': 'get',
		'url': `${BASE_URL}${CCAAS_LIST_NOTIFICATION_SUBSCRIPTION}`,
		'headers': {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Axios 1.1.3'
		}
	};

	try {
		const listSubscriptionsResponse = await axios(options);
        console.log(JSON.stringify(listSubscriptionsResponse.data));
        for (var i = 0; i < listSubscriptionsResponse.data.subscriptions.length; i++) {
            if (listSubscriptionsResponse.data.subscriptions[i].transport.endpoint == NOTIFICATION_URL) {
                await deleteNotificationSubscription(listSubscriptionsResponse.data.subscriptions[i].subscriptionId);
            }
        }
	} catch (e) {
		console.log(`Exception listSubscriptions: ${e}`);
	}
}

async function createNotificationWebhook() {
    /*const data = {
        channelProviderId: "chat",
        callbackUrl: REQUEST_URL,
        eventTypes: [
            "ALL"
        ]
    };*/
    const data = {
        events: [
            "ALL"
        ],
        transport: {
            type: "WEBHOOK",
            endpoint: NOTIFICATION_URL
        },
        family: "AGENT_ENGAGEMENT"
    }
	var options = {
		'method': 'post',
        'data': JSON.stringify(data),
		'url': `${BASE_URL}${CCAAS_CREATE_NOTIFICATION_WEBHOOK}`,
		'headers': {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Axios 1.1.3'
		}
	};
	try {
		const createWebhookResponse = await axios(options);
        console.log(JSON.stringify(createWebhookResponse.data));
	} catch (e) {
		console.log(`Exception createWebhook: ${e}`);
	}
}

async function listDeleteDigitalSubscriptions() {
	var options = {
		'method': 'get',
		'url': `${BASE_URL}${CCAAS_LIST_DIGITAL_SUBSCRIPTION}?channelProviderId=chat`,
		'headers': {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Axios 1.1.3'
		}
	};
	try {
		const listSubscriptionsResponse = await axios(options);
        console.log(JSON.stringify(listSubscriptionsResponse.data));
        for (var i = 0; i < listSubscriptionsResponse.data.length; i++) {
            if (listSubscriptionsResponse.data[i].callbackUrl == DIGITAL_URL) {
                await deleteDigitalSubscription(listSubscriptionsResponse.data[i].subscriptionId);
            }
        }
	} catch (e) {
		console.log(`Exception listSubscriptions: ${e}`);
	}
}

async function deleteDigitalSubscription(subscriptionId) {
    console.log(`Delete:  ${BASE_URL}${CCAAS_LIST_DIGITAL_SUBSCRIPTION}/${subscriptionId}`);
	var options = {
		'method': 'delete',
		'url': `${BASE_URL}${CCAAS_LIST_DIGITAL_SUBSCRIPTION}/${subscriptionId}`,
		'headers': {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/problem+json',
            'User-Agent': 'Axios 1.1.3'
		}
	};
	try {
		const deleteSubscriptionResponse = await axios(options);
	} catch (e) {
		console.log(`Exception deleteSubscriptions: ${e}`);
	}
}

async function deleteNotificationSubscription(subscriptionId) {
    console.log(`Delete:  ${BASE_URL}${CCAAS_LIST_NOTIFICATION_SUBSCRIPTION}/${subscriptionId}`);
	var options = {
		'method': 'delete',
		'url': `${BASE_URL}${CCAAS_LIST_NOTIFICATION_SUBSCRIPTION}/${subscriptionId}`,
		'headers': {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/problem+json',
            'User-Agent': 'Axios 1.1.3'
		}
	};
	try {
		const deleteSubscriptionResponse = await axios(options);
	} catch (e) {
		console.log(`Exception deleteSubscriptions: ${e}`);
	}
}

async function createDigitalWebhook() {
    const data = {
        channelProviderId: "chat",
        callbackUrl: DIGITAL_URL,
        eventTypes: [
            "ALL"
        ]
    };

	var options = {
		'method': 'post',
        'data': JSON.stringify(data),
		'url': `${BASE_URL}${CCAAS_CREATE_DIGITAL_WEBHOOK}`,
		'headers': {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Axios 1.1.3'
		}
	};
	try {
		const createWebhookResponse = await axios(options);
        console.log(JSON.stringify(createWebhookResponse.data));
	} catch (e) {
		console.log(`Exception createWebhook: ${e}`);
	}
}