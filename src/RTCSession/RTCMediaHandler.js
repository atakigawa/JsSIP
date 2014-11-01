/**
 * @fileoverview RTCMediaHandler
 */

/* RTCMediaHandler
 * @class PeerConnection helper Class.
 * @param {JsSIP.RTCSession} session
 * @param {Object} [contraints]
 */
(function(JsSIP){

var RTCMediaHandler = function(session, constraints) {
  constraints = constraints || {};

  this.logger = session.ua.getLogger('jssip.rtcsession.rtcmediahandler', session.id);
  this.session = session;
  this.localMedia = null;
  this.peerConnection = null;
  this.ready = true;

  this.init(constraints);
};

RTCMediaHandler.prototype = {
  isReady: function() {
    return this.ready;
  },
  
  createOffer: function(onSuccess, onFailure, constraints) {
    var
      self = this,
      isFullTrickle = this.session.ua.configuration.is_ice_full_trickle;

    function onSetLocalDescriptionSuccess() {
      if (self.peerConnection.iceGatheringState === 'complete' &&
          self.peerConnection.iceConnectionState === 'connected') {
        self.ready = true;
        onSuccess(self.peerConnection.localDescription.sdp);
      } else if (isFullTrickle) {
        self.ready = true;
        onSuccess(self.peerConnection.localDescription.sdp);
      } else {
        self.onIceCompleted = function() {
          self.onIceCompleted = undefined;
          self.ready = true;
          onSuccess(self.peerConnection.localDescription.sdp);
        };
      }
    }
    
    this.ready = false;

    this.peerConnection.createOffer(
      function(sessionDescription){
        self.setLocalDescription(
          sessionDescription,
          onSetLocalDescriptionSuccess,
          function(e) {
            self.ready = true;
            onFailure(e);
          }
        );
      },
      function(e) {
        self.ready = true;
        self.logger.error('unable to create offer');
        self.logger.error(e);
        onFailure(e);
      },
      constraints
    );
  },

  createAnswer: function(onSuccess, onFailure, constraints) {
    var
      self = this,
      remoteSupportsTrickleIce = this.session.remoteSupportsTrickleIce();

    function onSetLocalDescriptionSuccess() {
      if (self.peerConnection.iceGatheringState === 'complete' &&
          self.peerConnection.iceConnectionState === 'connected') {
        self.ready = true;
        onSuccess(self.peerConnection.localDescription.sdp);
      } else if (remoteSupportsTrickleIce) {
        self.ready = true;
        onSuccess(self.peerConnection.localDescription.sdp);
      } else {
        self.onIceCompleted = function() {
          self.onIceCompleted = undefined;
          self.ready = true;
          onSuccess(self.peerConnection.localDescription.sdp);
        };
      }
    }
    
    this.ready = false;

    this.peerConnection.createAnswer(
      function(sessionDescription){
        self.setLocalDescription(
          sessionDescription,
          onSetLocalDescriptionSuccess,
          function(e) {
            self.ready = true;
            onFailure(e);
          }
        );
      },
      function(e) {
        self.ready = true;
        self.logger.error('unable to create answer');
        self.logger.error(e);
        onFailure(e);
      },
      constraints
    );
  },

  setLocalDescription: function(sessionDescription, onSuccess, onFailure) {
    var self = this;

    this.peerConnection.setLocalDescription(
      sessionDescription,
      onSuccess,
      function(e) {
        self.logger.error('unable to set local description');
        self.logger.error(e);
        onFailure(e);
      }
    );
  },

  addStream: function(stream, onSuccess, onFailure, constraints) {
    try {
      this.peerConnection.addStream(stream, constraints);
    } catch(e) {
      this.logger.error('error adding stream');
      this.logger.error(e);
      onFailure();
      return;
    }

    onSuccess();
  },

  /* send locally harvested candidates to remote */
  onIceCandidate: function(event) {
    if (!event.candidate) {
      return;
    }

    this.session.sendIceCandidate(event.candidate);
  },

  /* set candidates sent from remote to local */
  addIceCandidate: function(iceCandidate, onSuccess, onError) {
    this.peerConnection.addIceCandidate(
      iceCandidate,
      onSuccess,
      onError
    );
  },

  /**
  * peerConnection creation.
  * @param {Function} onSuccess Fired when there are no more ICE candidates
  */
  init: function(options) {
    options = options || {};
    
    var idx, length, server,
      self = this,
      servers = [],
      constraints = options.constraints || {},
      stun_servers = options.stun_servers  || null,
      turn_servers = options.turn_servers || null,
      config = this.session.ua.configuration;

    if (!stun_servers) {
      stun_servers = config.stun_servers;
    }

    if (!turn_servers) {
      turn_servers = config.turn_servers;
    }
    
    if (stun_servers.length > 0) {
      servers.push({'urls': stun_servers});
    }
    
    length = turn_servers.length;
    for (idx = 0; idx < length; idx++) {
      server = turn_servers[idx];
      servers.push({
        'urls': server.urls,
        'username': server.username,
        'credential': server.credential
      });
    }

    this.peerConnection = new JsSIP.WebRTC.RTCPeerConnection({'iceServers': servers}, constraints);

    this.peerConnection.onaddstream = function(e) {
      self.logger.log('stream added: '+ e.stream.id);
    };

    this.peerConnection.onremovestream = function(e) {
      self.logger.log('stream removed: '+ e.stream.id);
    };

    this.peerConnection.onicecandidate = function(e) {
      if (e.candidate) {
        self.logger.log('ICE candidate received: '+ e.candidate.candidate);
        self.onIceCandidate(e);
      } else if (self.onIceCompleted !== undefined) {
        self.onIceCompleted(e);
      }
    };

    this.peerConnection.oniceconnectionstatechange = function() {
      self.logger.log('ICE connection state changed to "'+ this.iceConnectionState +'"');
      
      if (this.iceConnectionState === 'disconnected') {
        self.session.terminate({
            cause: JsSIP.C.causes.RTP_TIMEOUT,
            status_code: 200,
            reason_phrase: JsSIP.C.causes.RTP_TIMEOUT
          });
      }
    };


    this.peerConnection.onstatechange = function() {
      self.logger.log('PeerConnection state changed to "'+ this.readyState +'"');
    };
  },

  close: function() {
    this.logger.log('closing PeerConnection');
    if(this.peerConnection) {
      this.peerConnection.close();

      if(this.localMedia) {
        this.localMedia.stop();
      }
    }
  },

  /**
  * @param {Object} mediaConstraints
  * @param {Function} onSuccess
  * @param {Function} onFailure
  */
  getUserMedia: function(onSuccess, onFailure, constraints) {
    var self = this;

    this.logger.log('requesting access to local media');

    JsSIP.WebRTC.getUserMedia(constraints,
      function(stream) {
        self.logger.log('got local media stream');
        self.localMedia = stream;
        onSuccess(stream);
      },
      function(e) {
        self.logger.error('unable to get user media');
        self.logger.error(e);
        onFailure();
      }
    );
  },

  /**
  * Message reception.
  * @param {String} type
  * @param {String} sdp
  * @param {Function} onSuccess
  * @param {Function} onFailure
  */
  onMessage: function(type, body, onSuccess, onFailure) {
    var
      self = this,
      isHackAsterisk = self.session.ua.configuration.hack_asterisk,
      isOutgoing = self.session.direction === "outgoing",
      localDescription = self.peerConnection.localDescription,
      aProtoMatch;

    if (isHackAsterisk && isOutgoing) {
      //revert the quirk back.
      if (localDescription && body.indexOf("a=fingerprint") !== -1) {
        aProtoMatch = localDescription.sdp.match(/m=audio \d+ ([\w\/]+)\b/);
        if (aProtoMatch.length > 1) {
          body = body.replace(/(m=audio \d+) [\w\/]+\b/, "$1 " + aProtoMatch[1]);
        }
      }
      //do not set pranswer as remote description.
      //at least chrome doesn't seem to support it so far.
      //https://code.google.com/p/webrtc/issues/detail?id=3349
      //https://code.google.com/p/webrtc/issues/detail?id=3530
      if (type === 'pranswer') {
        return;
      }
    }

    this.peerConnection.setRemoteDescription(
      new JsSIP.WebRTC.RTCSessionDescription({type: type, sdp:body}),
      onSuccess,
      onFailure
    );
  }
};

// Return since it will be assigned to a variable.
return RTCMediaHandler;
}(JsSIP));
