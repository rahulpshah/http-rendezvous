const _ = require('lodash');
const assert = require('assert');
const EventEmitter = require('events');
const miss = require('mississippi');

const SessionManager = require('../lib/session-manager');
const Session = SessionManager.Session;

function from(data, interval) {
  interval = interval || 0;
  return miss.from((size, next) => {
    if(data.length <= 0) return next(null, null);
    var chunk = data.slice(0, size);
    data = data.slice(size);
    setTimeout(next.bind(null, null, chunk), interval);
  });
}
function to(cb) {
  var data = '';
  return miss.to(
    (chunk, enc, cb) => {
      data += chunk;
      cb();
    },
    (_cb) => {
      _cb();
      setImmediate(cb.bind(null, data));
    }
  );
}

module.exports = {
  'Session Adapter': {

    'should create a session': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();
      assert(sess);
      sess.deactivate();
    },

    'should get a session by id': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();

      assert.equal(manager.getSession(sess.id).id, sess.id);
      sess.deactivate();
    },
    'should remove session after timeout once deactivated': function(done) {
      var manager = new SessionManager({session_ttl: 5});
      var sess = manager.createSession();

      assert.equal(manager.getSession(sess.id).id, sess.id);
      sess.deactivate();
      setTimeout(() => {
        assert.equal(manager.getSession(sess.id), undefined);
        done();
      }, 10);
    }
  },

  'Session': {

    'should create session with initial state "CREATED"': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();

      assert.equal(sess.state, 'CREATED');
      sess.deactivate();
    },

    'should timeout after ttl without source or destination': function(done) {
      var manager = new SessionManager({session_ttl: 10});
      var sess = manager.createSession();

      assert.equal(sess.state, 'CREATED');
      var timeout = setTimeout(v => {
        done(new Error('timeout not emitted'));
      }, 20);

      sess.once('timeout', sess => {
        assert.equal(sess.state, 'TIMEOUT_NO_SRC_NO_DST');
        clearTimeout(timeout);
        done();
      });
    },

    'should register source': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var req = new EventEmitter();
      sess.registerSource(req);
      assert.equal(sess.state, 'SRC_CONNECTED');

      sess.deactivate();
    },

    'should register destination': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var req = new EventEmitter();
      sess.registerDestination(req);
      assert.equal(sess.state, 'DST_CONNECTED');

      sess.deactivate();
    },

    'should register client error': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();
      var error = { http_status:400, name:'GenericError', message:'generic error happened' };

      sess.registerClientError(error);

      assert.equal(sess.client_error.http_status, error.http_status);
      assert.equal(sess.client_error.name, error.name);
      assert.equal(sess.client_error.message, error.message);
      assert.equal(sess.state, 'CLIENT_ERROR');

      sess.deactivate();
    },

    'should emit client error': function(done) {
      var manager = new SessionManager();
      var sess = manager.createSession();
      var error = { http_status:400, name:'GenericError', message:'generic error happened' };

      sess.once('client_error', sess => {
        assert.equal(sess.client_error.http_status, error.http_status);
        assert.equal(sess.client_error.name, error.name);
        assert.equal(sess.client_error.message, error.message);
        done();
      });

      sess.registerClientError(error);
    },

    'should wait for event handlers before releasing resources on client error': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();
      var error = { http_status:400, name:'GenericError', message:'generic error happened' };

      var finished = false;
      sess.once('client_error', sess => {
        var i = 0;
        while (++i < 50) true;
        finished = true;
      });

      sess.registerClientError(error);
      assert.equal(finished, true);
      assert.equal(sess.active, false);
    },

    'should timeout after ttl with source not destination': function(done) {
      var manager = new SessionManager({session_ttl: 10});
      var sess = manager.createSession();

      var req = new EventEmitter();
      sess.registerSource(req);

      var timeout = setTimeout(v => {
        done(new Error('timeout not emitted'));
      }, 20);

      sess.once('timeout', sess => {
        assert.equal(sess.state, 'TIMEOUT_NO_DST');
        clearTimeout(timeout);
        done();
      });
    },

    'should timeout after ttl with destination not source': function(done) {
      var manager = new SessionManager({session_ttl: 10});
      var sess = manager.createSession();

      var req = new EventEmitter();
      sess.registerDestination(req);

      var timeout = setTimeout(v => {
        done(new Error('timeout not emitted'));
      }, 20);

      sess.once('timeout', sess => {
        assert.equal(sess.state, 'TIMEOUT_NO_SRC');
        clearTimeout(timeout);
        done();
      });
    },

    'should throw if source already registered': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var req = new EventEmitter();
      sess.registerSource(req);
      assert.equal(sess.state, 'SRC_CONNECTED');

      assert.throws(sess.registerSource.bind(sess, req), err => {
        assert.equal(err.message, 'Source already registered');
        return true;
      });
    },

    'should throw if destination already registered': function() {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var req = new EventEmitter();
      sess.registerDestination(req);
      assert.equal(sess.state, 'DST_CONNECTED');

      assert.throws(sess.registerDestination.bind(sess, req), err => {
        assert.equal(err.message, 'Destination already registered');
        return true;
      });
    },

    'should fail if streaming & source has error': function(done) {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var data = 'abcdef';
      var src = from(data, 10);
      var dst = to(data => {
        assert(false, 'should not reach here');
      });

      sess.registerSource(src);
      sess.registerDestination(dst);
      assert.equal(sess.state, 'STREAMING');

      sess.on('error', err => {
        assert.equal(sess.state, 'SRC_ERROR');
        assert.equal(err.message, 'Source error: blahdeblah');
        done();
      });

      setTimeout(v => {
        src.emit('error', new Error('blahdeblah'));
      });
    },

    'should fail if streaming & destination has error': function(done) {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var data = 'abcdef';
      var src = from(data, 10);
      var dst = to(data => {
        assert(false, 'should not reach here');
      });

      sess.registerSource(src);
      sess.registerDestination(dst);
      assert.equal(sess.state, 'STREAMING');

      sess.on('error', err => {
        assert.equal(sess.state, 'DST_ERROR');
        assert.equal(err.message, 'Destination error: blahdeblah');
        done();
      });

      setTimeout(v => {
        dst.emit('error', new Error('blahdeblah'));
      });
    },

    'should fail if streaming & source disconnects': function(done) {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var data = 'abcdef';
      var src = from(data, 10);
      var dst = to(data => {
        assert(false, 'should not reach here');
      });

      sess.registerSource(src);
      sess.registerDestination(dst);
      assert.equal(sess.state, 'STREAMING');

      sess.on('error', err => {
        assert.equal(sess.state, 'SRC_DISCONNECTED');
        assert.equal(err.message, 'Source disconnected before end');
        done();
      });

      setTimeout(v => {
        src.emit('close');
      });
    },

    'should fail if streaming & destination disconnects': function(done) {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var data = 'abcdef';
      var src = from(data, 10);
      var dst = to(data => {
        assert(false, 'should not reach here');
      });

      sess.registerSource(src);
      sess.registerDestination(dst);
      assert.equal(sess.state, 'STREAMING');

      sess.on('error', err => {
        assert.equal(sess.state, 'DST_DISCONNECTED');
        assert.equal(err.message, 'Destination disconnected before end');
        done();
      });

      setTimeout(v => {
        dst.emit('close');
      });
    },

    'should track bytes transferred': function(done) {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var data = 'abcdef';
      var src = from(data);
      var dst = to(data => {
        assert.equal(sess.state, 'FINISHED');
        assert.equal(sess.bytes_transferred, 6);
        done();
      });

      sess.registerSource(src);
      sess.registerDestination(dst);
      assert.equal(sess.state, 'STREAMING');
    },

    'should fail if no bytes moved in rolling window': function() { this.skip(); },

    'should complete successfully if source then destination registered': function(done) {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var data = 'abcdef';
      var src = from(data);
      var dst = to(data => {
        assert.equal(sess.state, 'FINISHED');
        assert.equal(sess.bytes_transferred, 6);
        done();
      });

      sess.registerSource(src);

      setTimeout(v => {
        sess.registerDestination(dst);
        assert.equal(sess.state, 'STREAMING');
      }, 10);
    },

    'should complete successfully if destination then source registered': function(done) {
      var manager = new SessionManager();
      var sess = manager.createSession();

      var data = 'abcdef';
      var src = from(data);
      var dst = to(data => {
        assert.equal(sess.state, 'FINISHED');
        assert.equal(sess.bytes_transferred, 6);
        done();
      });

      sess.registerDestination(dst);

      setTimeout(v => {
        sess.registerSource(src);
        assert.equal(sess.state, 'STREAMING');
      }, 10);
    },

  }
}
