(function(JsSIP) {

var ICECandidate,
  C = {};

ICECandidate = function(session) {
  var events = [
    'succeeded',
    'failed'
  ];

  this.logger = session.ua.getLogger('jssip.rtcsession.icecandidate', session.id);
  this.owner = session;

  this.initEvents(events);
};
ICECandidate.prototype = new JsSIP.EventEmitter();

/* handle incoming candidates from remote */
ICECandidate.prototype.handleIncoming = function(request) {
  var self = this, i = 0, lineRaw, line, lp, rp, attrName,
    lines = (request.body || "").split("\r\n"),
    cnt = lines.length,
    iceCandidateObj = {},
    iceCandidate,
    onAddIceCandidateSuccess,
    onAddIceCandidateError;

  for (i; i < cnt; i++) {
    lineRaw = lines[i];
    line = lineRaw.split(':');
    //ipv6 addresses are ignored here.
    if (line.length !== 2) { continue; }

    lp = line[0].split('=');
    if (lp.length !== 2) { continue; }
    if (lp[0] !== 'a') { continue; }
    attrName = lp[1];

    rp = line[1];

    if (attrName === 'mid') {
        iceCandidateObj.sdpMid = rp;
    }
    else if (attrName === 'm-line-id') {
        iceCandidateObj.sdpMLineIndex = +rp;
    }
    else if (attrName === 'candidate') {
        iceCandidateObj.candidate = lineRaw;
    }
  }
  if (!iceCandidateObj.candidate) { return; }

  iceCandidate = new JsSIP.WebRTC.RTCIceCandidate(iceCandidateObj);
  onAddIceCandidateSuccess = function() {
    self.emit('succeeded', self, {
      originator: 'remote',
      request: request
    });
  };
  onAddIceCandidateError = function() {
    self.emit('failed', self, {
      originator: 'remote',
      request: request,
      cause: JsSIP.C.causes.BAD_MEDIA_DESCRIPTION
    });
  };

  this.owner.rtcMediaHandler.addIceCandidate(
    iceCandidate,
    onAddIceCandidateSuccess,
    onAddIceCandidateError
  );

  request.reply(200);
};


ICECandidate.C = C;
JsSIP.RTCSession.ICECandidate = ICECandidate;
}(JsSIP));
