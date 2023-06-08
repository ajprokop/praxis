$(document).ready(init);

const SERVER_PORT = 3101;

var socketURL = `wss://cxi-development.com:${SERVER_PORT}`;
var socketio;

var sessionId;
var engagementId;
var dialogId;

function init() {
	connectSocket();
	clearAllChats()
	$('#message').prop("readonly", true);
	$('#sendMsg').prop("disabled", true);
}

var input = document.getElementById("message");
input.addEventListener("keyup", function(event) {
  if (event.key === "Enter") {
   event.preventDefault();
   document.getElementById("sendMsg").click();
  }
});

function connectSocket() {
	socketio = io.connect(socketURL, {});
	socketio.on('connect', function(socket) {
	  console.log("Connected");
	});
	socketio.on("RECEIVE_PROMPT", function(msg) {
	  writeToTrace(msg.prompt, msg.type);
	});
	socketio.on("DISCONNECTED", function(msg) {
		clearAllChats()
		$('#message').prop("readonly", true);
		$('#sendMsg').prop("disabled", true);
		document.getElementById("connect").innerHTML = "Agent";
	  });
  }

  function disconnectSocket() {
	socketio.emit("UNSUBSCRIBE", {phoneNumber: document.getElementById('userChat').value});
  }

  function startConnectSocket() {
	if(document.getElementById("connect").innerHTML == "Disconnect") {
		  disconnectSocket();
		  return;
	  }
	socketio.emit("SUBSCRIBE", {phoneNumber: document.getElementById('userChat').value});
  }

function sendMsg() {
	var settings = {
		"url": `https://cxi-development.com:${SERVER_PORT}/sendChatMsg`,
		"method": "POST",
		"timeout": 0,
		"headers": {
		  "Content-Type": "application/json",
		  "Accept": "application/json"
		},
		"data": JSON.stringify({
		  "message": $('#message').val(),
		  "engagementId": engagementId,
		  "dialogId": dialogId,
		  "sessionId": sessionId,
		  "correlationId": "1111",
		  "senderName": document.getElementById("userChat").value
		}),
	  };
	  
	  $.ajax(settings).done(function (response) {
		console.log(response);
		document.getElementById('message').value = "";
	  });
}

function clearAllChats() {
		var consoleTxt = $('#console-log').val();
		$('#console-log').val("");
		$("#console-log span").remove();		
}

function disconnect() {
	var settings = {
		"url": `https://cxi-development.com:${SERVER_PORT}/disconnectEngagement`,
		"method": "POST",
		"timeout": 0,
		"headers": {
		  "Content-Type": "application/json",
		  "Accept": "application/json"
		},
		"data": JSON.stringify({
		  "sessionId": sessionId,
		  "engagementId": engagementId,
		  "dialogId": dialogId
		}),
	  };
	  
	  $.ajax(settings).done(function (response) {
		console.log(response);
	  });
	  clearAllChats()
	  $('#message').prop("readonly", true);
	  $('#sendMsg').prop("disabled", true);
	  document.getElementById("connect").innerHTML = "Agent";
}

function startConnect() {
	startConnectSocket();
	if(document.getElementById("connect").innerHTML == "Disconnect") {
		disconnect();
		return;
	}
	var input = document.getElementById("userChat").value;
	if (input.trim() == '') {
		window.alert("You must enter a user name!");
		return;
	}
	var settings = {
		"url": `https://cxi-development.com:${SERVER_PORT}/connect`,
		"method": "POST",
		"timeout": 0,
		"headers": {
		  "Content-Type": "application/json",
		  "Accept": "application/json"
		},
		"data": JSON.stringify({
		  "phone":$('#userChat').val()
		}),
	  };
	  
	  $.ajax(settings).done(function (response) {
		console.log(response);
		var jsonResponse = JSON.parse(response);
		sessionId = jsonResponse.sessionId;
		engagementId = jsonResponse.engagementId;
		dialogId = jsonResponse.dialogId;
		document.getElementById("connect").innerHTML = "Disconnect"
		$('#sendMsg').prop("disabled", false);
		$('#message').prop("readonly", false);
		writeToTrace(`System: Please wait while I connect you to the next available agent`, "AGENT");
	  });
}

function writeToTrace(text, type) {
	text = text.trim();
	addToConsole(text, type);
  }

  function addToConsole(msg, type) {
	var span = createLogElement(msg, type);
	$('#console-log').append(span);
	document.getElementById("console-log").scrollTop = document.getElementById("console-log").scrollHeight;
  }

  function createLogElement(msg, type) {
	var span = document.createElement('span');
	if (type == "USER") {
	  $(span).addClass('log-element');
	} else if (type == "AGENT") {
	  $(span).addClass('log-element-agent');
	} else {
		$(span).addClass('log-element-gpt');
	}
	var msgArray = msg.split(':');
	var sender = msgArray[0];
	var restMsg = "";
	for (var i = 1; i < msgArray.length; i++) {
	  if (i == 1) {
		restMsg += " " + msgArray[i];
	  } else {
		restMsg += ":" + msgArray[i];
	  }
	}
	var sendSpan = document.createElement('span');
	$(sendSpan).addClass('log-element-sender');
	sendSpan.innerHTML = sender + ":";
	var msgSpan = document.createElement('span');
	$(msgSpan).addClass('log-element-msg');
	$(msgSpan).append(messageWithLink(restMsg));
	$(span).append(sendSpan);
	$(span).append(msgSpan);
	return span;
  }

  function messageWithLink(msg) {
	var matches = msg.match(/[(http(s)?):\/\/(www\.)?a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/g);
	if(matches) {
		for(var i = 0; i < matches.length; i++) {
			if(matches[i].toLowerCase().indexOf("http") != -1) { 
				// The user or agent put a link into the chat window
				msg = msg.replace(matches[i], '<a href = "' + matches[i] + '" target = "_blank">' + matches[i] + '</a>');
			}
		}
	}
	return msg;
}