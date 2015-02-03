var TransitionState = {
  ANIMATING: 'ANIMATING',
  IDLE: 'IDLE',
  PAUSED: 'PAUSED'
}

/**
 * @method isLatLng
 * @param {Object} location The location to be checked.
 * @returns {boolean} If true, the location is an instance of google.maps.LatLng
 */
function isLatLng(location) {
  return location instanceof google.maps.LatLng;
}

/**
 * MapTransitionManager
 *  - Is a wrapper for transitions on its Google Map.
 *  - The transitions have callbacks which are fired once the map is idle.
 *  - A typical transition is:
 *    fitBounds -> panTo -> transition complete callback
 *
 * @constructor
 * @param {google.maps.Map} map The Google Map the transitions occur on.
 */
function MapTransitionManager(map) {
  this.setMap(map);
}

MapTransitionManager.prototype = {

  /**
   * The Google Map the transitions occur on.
   * 
   * @property _map
   * @type google.maps.Map
   * @default null
   */
  _map: null,

  /**
   * The listener for the next `idle` map event - see `uponMapIdle`.
   * 
   * @property _idleListener
   * @type google.maps.MapsEventListener
   * @default null
   */
  _idleListener: null,

  /**
   * @method setMap
   * @param map {google.maps.Map} The map on which the transitions occur. Null
   * if no map is given.
   */
  setMap: function(map) {
    this._map = (map instanceof google.maps.Map) ? map : null;
  },

  /**
   * @method getMap
   * @returns {google.maps.Map} The map on which the transitions occur.
   */
  getMap: function(map) {
    return this._map;
  },

  /**
   * @method _uponMapIdle
   * @param {Function} handler The handler to call when the map is idle.
   * Will replace the existing idle handler. If null, removes the current
   * idle handler.
   */
  _uponMapIdle: function(handler) {
    google.maps.event.removeListener(this._idleListener);
    if (handler) {
      this._idleListener = new google.maps.event.addListenerOnce(this._map,
          'idle', handler);
    }
  },

  /**
   * Removes the idle listener.
   *
   * @method stopTransition
   */
  stopTransition: function() {
    this._uponMapIdle(null);
  },

  /**
   * Fits the bounds of the map to the given scene locations.
   * The first stage of the default transition to a scene.
   * The default transition to a scene:
   *   - `fitBounds -> panTo -> callback/transitionComplete`
   *   - each stage [`->`] occurs when the map is `idle`
   * Note: The last location is the last valid location in the locations array.
   *
   * @method fitBounds
   * @param {!Array.<!google.maps.LatLng>} locations LatLngs to fit the 
   * bounds to.
   * @param {boolean} panToLastLocation If true, pan to the last location given.
   */
  fitBounds: function(locations, panToLastLocation, callback) {
    if (!this._map) return;
    this.stopTransition();
    var bounds = new google.maps.LatLngBounds();
    var lastLocation = null;
    for (var i = locations.length - 1, location; location = locations[i]; --i) {
      if (!isLatLng(location)) continue;
      bounds.extend(location);
      if (panToLastLocation && !lastLocation) lastLocation = location;
    }
    // Ensure the bounds have a valid span:
    // i.e. At least two different locations were given.
    var span = bounds.toSpan();
    if (span.lat() || span.lng()) {
      this._map.fitBounds(bounds);
      if (!panToLastLocation) this._uponMapIdle(callback);
      else this._uponMapIdle(this.panTo.bind(this, lastLocation, callback));
    } else if (lastLocation) {
      this.panTo(lastLocation, callback);
    }
  },

  /**
   * Pans to the upcoming scene (the scene that `index` points to).
   * If the location or map are invalid, the transition is seen as complete,
   * so the callback is invoked.
   *
   * @method panToScene
   * @param {google.maps.LatLng} location LatLng to pan to.
   * @param {Function} onTransitionComplete The callback to invoke on completion
   * of the transition.
   */
  panTo: function(location, onTransitionComplete) {
    this.stopTransition();
    if (isLatLng(location) && this._map &&
        !this._map.getCenter().equals(location)) {
      this._map.panTo(location);
      this._uponMapIdle(onTransitionComplete);
    } else if (onTransitionComplete) {
      // Invoke the callback if the pan is not needed.
      onTransitionComplete();
    }
  }

}

/**
 * @method setLast
 * @param {!google.maps.Polyline} polyline The polyline to set the location on.
 * @param {!google.maps.LatLng} location The location to set at the end of the 
 * polyline.
 */
function setLast(polyline, location) {
  var path = polyline.getPath();
  path.setAt(path.length - 1, location);
}

/**
 * @method getPointOnLine
 * @param {!google.maps.Polyline} polyline The polyline to get the point from.
 * @param {number} index The index of the point to retrieve (can be negative).
 */
function getPointOnLine(polyline, index) {
  var path = polyline.getPath();
  var length = path.length;
  return path.getAt(((index % length) + length) % length);
}

/**
 * LinearAnimationManager
 * The manager controls a single linear line animation and coordinates this
 * alongside the map transitions (it uses a MapTransitionManager for this).
 *
 * Line animation methods:
 *  - next: the line grows to the next location in its path.
 *  - prev: the line shrinks to the previous location in its path.
 *  - pause: pause the line animation.
 *
 * Updating the current index of the path without the line animation:
 *  - setCurrentIndex: has the map transitions, but no line animation.
 *
 * Updating the path:
 *  - insertAt: insert a location into the path at the given index.
 *  - setAt: set the location of the path at the given index.
 *  - removeAt: remove the location from the path at the given index.
 *
 * @constructor
 * @param {google.maps.Map} map The map the animations and transitions occur on.
 */
function LinearAnimationManager(map) {
  this._prevLine = this.makePolyline(0.6);
  this._nextLine = this.makePolyline(0.2);
  this.mapTransitionManager = new MapTransitionManager(map);
  this.setMap(map);
}

LinearAnimationManager.prototype = {

  /**
   * The state of the LinearAnimationManager.
   *   - `IDLE` - The manager is not doing anything.
   *   - `PAUSED` - A line animation was paused.
   *   - `ANIMATING` - A line animation is in progress.
   *
   * @property _state
   * @type TransitionState
   * @default TransitionState.IDLE
   */
  _state: TransitionState.IDLE,

  /**
   * Duration of each line animation in milliseconds.
   *
   * @property _ANIMATION_TIME_MS
   * @type number
   * @default 5000
   */
  _ANIMATION_TIME_MS: 3000,

  /**
   * The intervalId of the current line animation frame, if it is animated.
   *
   * @property _intervalId
   * @type number
   * @default 0
   */
  _intervalId: 0,

  /**
   * The offset in the forward linear direction of the line animation.
   * (Only applies if the transition state is not idle.)
   * 
   * @property _offset
   * @type number
   * @default 0
   */
  _offset: 0,

  /**
   * The polyline containing the points of the previous locations
   *  - i.e. the points with index <= the current index
   * 
   * @property _prevLine
   * @type google.maps.Polyline
   * @default null
   */
  _prevLine: null,

  /**
   * The polyline containing the points of the next locations:
   *  - i.e. the points with index >= the current index
   * 
   * @property _nextLine
   * @type google.maps.Polyline
   * @default null
   */
  _nextLine: null,

  /**
   * The direction of the animation.  If true, the animation is going to 
   * the next point on the path.
   * 
   * @property _forward
   * @type boolean
   * @default true
   */
  _forward: true,

  /**
   * Sets the map on which the polyline and map transitions occur.
   *
   * @method setMap
   * @param {google.maps.Map} map The map on which the transitions occur.
   */
  setMap: function(map) {
    map = (map instanceof google.maps.Map) ? map : null;
    this._prevLine.setMap(map);
    this._nextLine.setMap(map);
    this.mapTransitionManager.setMap(map);
  },

  /**
   * @method getMap
   * @returns {google.maps.Map} The map on which the transitions occur.
   */
  getMap: function() {
    return this.mapTransitionManager.getMap();
  },

  /**
   * Sets the index of the current location - no line animation shown.
   * Fits the bounds to the current active location 
   * (or line segment, if animating), and the location at the given index.
   *
   * @method setCurrentIndex
   * @param {number} index The index of the location to set the path to.
   * @param {Function} onTransitionComplete The callback when the transition is
   * complete.
   */
  setCurrentIndex: function(index, onTransitionComplete) {
    var isAnimating = (this._state === TransitionState.ANIMATING);
    this.finishAnimation(false);
    var prevPath = this._prevLine.getPath().getArray();
    var nextPath = this._nextLine.getPath().getArray();
    var locations = [nextPath.pop()];
    if (isAnimating) {
      prevPath.pop();
      locations.push(prevPath[prevPath.length - 1]);
      locations.push(nextPath[nextPath.length - 1]);
    }
    totalPath = prevPath.concat(nextPath.reverse());
    index = index < totalPath.length ? index : (totalPath.length - 1);
    // Previous line path contains the points up to and including index
    this._prevLine.setPath(totalPath.slice(0, index + 1));
    // Next line path contains the points from the end to index (inclusive)
    this._nextLine.setPath(totalPath.slice(index).reverse());

    locations.push(totalPath[index]);
    this.mapTransitionManager.fitBounds(locations, true, onTransitionComplete);
  },

  /**
   * Gets the index of the current location.
   * NOTE: during animation/pause, this is the index of the upcoming scene.
   *
   * @method getCurrentIndex
   * @returns {number} The index of the current location.
   */
  getCurrentIndex: function() {
    var index = this._prevLine.getPath().length - 1;
    if (this._state === TransitionState.IDLE || this._forward) return index;
    return --index;
  },

  /**
   * @method insertAt
   * @param {number} index The index at which to insert the location.
   * @param {google.maps.LatLng} location The location to insert.
   */
  insertAt: function(index, location) {
    if (!isLatLng(location)) return;
    var currentIndex = this._prevLine.getPath().length - 1;
    if (currentIndex < 0 && !this._nextLine.getPath().length) {
      this._prevLine.getPath().insertAt(0, location);
      return this._nextLine.getPath().insertAt(0, location);
    }
    if (index > currentIndex) {
      index = this._nextLine.getPath().length + currentIndex - index;
      if (index < 0) return null;
      return this._nextLine.getPath().insertAt(index, location);      
    } else {
      return this._prevLine.getPath().insertAt(index, location);
    }
  },

  /**
   * @method setAt
   * @param {number} index The index at which to set the location.
   * @param {!google.maps.LatLng} location The location to set.
   */
  setAt: function(index, location) {
    if (!isLatLng(location)) return;
    var currentIndex = this._prevLine.getPath().length - 1;
    if (index < currentIndex) {
      return this._prevLine.getPath().setAt(index, location);
    } else if (index === currentIndex) {
      // TODO: This is on the previso that an animation is not in progress.
      setLast(this._prevLine, location);
      setLast(this._nextLine, location);
      this.mapTransitionManager.panTo(location);
    } else {
      index = this._nextLine.getPath().length - 1 + currentIndex - index;
      if (index < 0) return null;
      return this._nextLine.getPath().setAt(index, location);
    }
  },

  /**
   * @method removeAt
   * @param {number} index The index at which to remove the location.
   * @param {!google.maps.LatLng} location The location to remove.
   */
  removeAt: function(index) {
    var currentIndex = this._prevLine.getPath().length - 1;
    if (index < 0) index = 0;
    if (index < currentIndex) {
      return this._prevLine.getPath().removeAt(index);
    } else if (index === currentIndex) {
      // TODO: decide how this case is going to be handled, especially if
      // during an animation or similar.
    } else {
      index = this._nextLine.getPath().length - 1 + currentIndex - index;
      if (index < 0) index = 0;
      return this._nextLine.getPath().removeAt(index);
    }
  },

  /**
   * Makes a polyline with the given opacity.
   *
   * @method makePolyline
   * @param {number} opacity The opacity of the polyline.
   * @returns {google.maps.Polyline} The polyline created.
   */
  makePolyline: function(opacity) {
    var dash = {
      path: 'M 0,0 0,1',  // This is the SVG for a dash.
      strokeOpacity: opacity,
      scale: 2
    };
    // The dash symbol (see icons) is repeated every 2px to form a solid line.
    var lineOptions = {
      map: this.map,
      geodesic: true,
      strokeOpacity: 0,  // The line underneath the dashes is not visible.
      icons: [{
        icon: dash,
        offset: '0px',
        repeat: '2px'
      }]
    };
    return new google.maps.Polyline(lineOptions);
  },

  /**
   * @method hasNext
   * @returns {boolean} If true, the line has a next location.
   */
  hasNext: function() {
    var nextPathLength = this._nextLine.getPath().length;
    if (this._state === TransitionState.ANIMATING && this._forward) {
      return nextPathLength > 2;
    }
    return nextPathLength > 1;
  },

  /**
   * @method hasPrev
   * @returns {boolean} If true, the line has a previous location.
   */
  hasPrev: function() {
    var prevPathLength = this._prevLine.getPath().length;
    if (this._state === TransitionState.ANIMATING && !this._forward) {
      return prevPathLength > 2;
    }
    return prevPathLength > 1;
  },

  /**
   * @method next
   * @param {Function} onTransitionComplete The callback when the line and
   * map transition is complete.
   */
  next: function(onTransitionComplete) {
    if (!this.hasNext()) return;
    this.startAnimation(true, onTransitionComplete);
  },

  /**
   * @method prev
   * @param {Function} onTransitionComplete The callback when the line and
   * map transition is complete.
   */
  prev: function(onTransitionComplete) {
    if (!this.hasPrev()) return;
    this.startAnimation(false, onTransitionComplete);
  },

  /**
   * Pauses the polyline animation (if there is an animation in progress).
   *
   * @method pause
   */
  pause: function() {
    if (this._state === TransitionState.IDLE) return;
    this._state = TransitionState.PAUSED;
    this._cancelAnimation();
    this.mapTransitionManager.stopTransition();
  },

  /**
   * Starts a line animation moving to the next, or the previous.
   * If another line animation/transition is in progress, stop it.
   *
   * @method startAnimation
   * @param {number} from The index of the scene it is animating from.
   * @param {number} to The index of the scene it is animating to.
   */
  startAnimation: function(forward, onTransitionComplete) {
    this.mapTransitionManager.stopTransition();
    if (this._state === TransitionState.ANIMATING && forward === this._forward) {
      this.finishAnimation(false);
    } else if (this._state != TransitionState.IDLE) {
      this.pause();
    }
    this._forward = forward;
    var resume = (this._state === TransitionState.PAUSED);
    if (!resume) {
      var line = (!this._forward && this._nextLine) || this._prevLine;
      line.getPath().push(getPointOnLine(line, - 1));
    }
    this._state = TransitionState.ANIMATING;
    this.mapTransitionManager.fitBounds([getPointOnLine(this._prevLine, - 2), 
        getPointOnLine(this._nextLine, - 2)], false);
    /* NOTE: requestAnimationFrame gives the DOMHighResTimeStamp as the
     * last parameter in the callback. (The 1st parameter in this case.)
     */
    this._intervalId = window.requestAnimationFrame(step.bind(this));

    // A step/frame of the line animation.
    function step(startTime, currentTime) {
      if (!currentTime) currentTime = startTime;
      var diffTime = currentTime - startTime;
      var fromOffset = (diffTime / this._ANIMATION_TIME_MS);
      if (resume) {
        resume = false;
        fromOffset = this._forward ? this._offset : (1 - this._offset);
        diffTime = fromOffset*this._ANIMATION_TIME_MS;
        startTime -= diffTime;
      }

      if (fromOffset >= 1) {
        this.finishAnimation(true, onTransitionComplete);
        return;
      }
      
      this._offset = this._forward ? fromOffset : (1 - fromOffset);
      var wayPoint = new google.maps.geometry.spherical.interpolate(
          getPointOnLine(this._prevLine, - 2), 
          getPointOnLine(this._nextLine, - 2), this._offset);
      setLast(this._nextLine, wayPoint);
      setLast(this._prevLine, wayPoint);

      this._intervalId = window.requestAnimationFrame(
          step.bind(this, startTime));
    }
  },

  /**
   * Cancels the current animation frame.
   * NOTE: It does not update the manager's state, nor touch the polyline.
   *
   * @method _cancelAnimation
   * @returns {boolean} If false, there was no animation frame to cancel.
   */
  _cancelAnimation: function() {
    if (typeof this._intervalId != 'number' || 
        this._state === TransitionState.IDLE) return false;
    window.cancelAnimationFrame(this._intervalId);
    this._intervalId = null;
    return true;
  },

  /**
   * Completes the current line animation.
   *
   * @method finishAnimation
   * @param {boolean} finishTransition If true, finishes default transition.
   * @param {Function} onTransitionComplete The function to fire once the
   * transition is complete.
   */
  finishAnimation: function(finishTransition, onTransitionComplete) {
    if (!this._cancelAnimation()) return;
    this._state = TransitionState.IDLE;
    var shortenLine = (this._forward && this._nextLine) || this._prevLine;
    shortenLine.getPath().pop();
    var currentLoc = getPointOnLine(shortenLine, - 1);
    var line = (!this._forward && this._nextLine) || this._prevLine;
    setLast(line, currentLoc);
    if (finishTransition) this.mapTransitionManager.panTo(currentLoc, 
        onTransitionComplete);
    else if (onTransitionComplete) onTransitionComplete();
  }
}
