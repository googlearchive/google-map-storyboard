var TransitionState = {
  ANIMATING: 'ANIMATING',
  IDLE: 'IDLE',
  PAUSED: 'PAUSED'
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
  this.map = map;
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
   * @method set map
   * @param map {google.maps.Map} The map on which the transitions occur. Null
   * if no map is given.
   */
  set map(map) {
    this._map = (map instanceof google.maps.Map) ? map : null;
  },

  /**
   * @method get map
   * @returns {google.maps.Map} The map on which the transitions occur.
   */
  get map() {
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
   * @method removeIdleBehavior
   */
  removeIdleBehavior: function() {
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
   * @param {Function} callback (Optional) The callback to invoke on completion
   * of the transition. If !panToLastLocation, it is fired on the completion
   * of fitBounds, else it is invoked after panTo.
   */
  fitBounds: function(locations, panToLastLocation, callback) {
    if (!this._map) return;
    this.removeIdleBehavior();
    var lastLocation = locations[locations.length - 1];
    var hasDiffLocations = false;
    var bounds = new google.maps.LatLngBounds();
    for (var i = 0, location; location = locations[i]; ++i) {
      bounds.extend(location);
      if (!hasDiffLocations) hasDiffLocations = !location.equals(lastLocation);
    }
    // Ensure the bounds have at least two unique locations.
    if (hasDiffLocations) {
      this._map.fitBounds(bounds);
      if (!panToLastLocation) this._uponMapIdle(callback);
      else this._uponMapIdle(this.panTo.bind(this, lastLocation, callback));
    } else {
      // If only one unique location is given, pan to that location.
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
   * @param {Function} onTransitionComplete (Optional) The callback to invoke on
   * the completion of the transition.
   */
  panTo: function(location, onTransitionComplete) {
    this.removeIdleBehavior();
    if (location && this._map && !this._map.getCenter().equals(location)) {
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
 * @param {number} index The index of the point (single wrap around).
 * NOTE: If index < last negative path index, it returns the first point.
 *       If index > last path index, it returns the last point.
 *       If there are no points in the path, it returns undefined.
 */
function getPointOnLine(polyline, index) {
  var path = polyline.getPath();
  var length = path.length;
  index = index < 0 ? Math.max(index + length, 0) : Math.min(index, length - 1);
  return path.getAt(index);
}

/**
 * LinearAnimationManager
 * The manager controls a single linear line animation and coordinates this
 * alongside the map transitions (it uses a MapTransitionManager for this).
 *
 * Line animation methods:
 *  - next: the line grows to the next location in its path.
 *  - prev: the line shrinks to the previous location in its path.
 *  - pause: pauses the line animation.
 *
 * Updating the current index of the path without the line animation:
 *  - setCurrentIndex: has the map transitions, but no line animation.
 *
 * Updating the path:
 *  - insertAt: inserts a location into the path at the given index.
 *  - setAt: sets the location of the path at the given index.
 *  - removeAt: (NOTE: to be added) removes the location from the path at
 *    the given index.
 *
 * @constructor
 * @param {google.maps.Map} map The map the animations and transitions occur on.
 */
function LinearAnimationManager(map) {
  this._mapTransitionManager = new MapTransitionManager(map);
  this._prevLine = this.makePolyline(0.6);
  this._nextLine = this.makePolyline(0.2);
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
   * The MapTransitionManager co-ordinated by this LinearAnimationManager.
   * (So map animations and transitions are coordinated together.)
   *
   * @property _mapTransitionManager
   * @type MapTransitionManager
   * @default null
   */
  _mapTransitionManager: null,

  /**
   * Sets the map on which the polyline and map transitions occur.
   *
   * @method setMap
   * @param {google.maps.Map} map The map on which the transitions occur.
   */
  set map(map) {
    map = (map instanceof google.maps.Map) ? map : null;
    this._prevLine.setMap(map);
    this._nextLine.setMap(map);
    this._mapTransitionManager.map = map;
  },

  /**
   * @method getMap
   * @returns {google.maps.Map} The map on which the transitions occur.
   */
  get map() {
    return this._mapTransitionManager.map;
  },

  /**
   * Sets the index of the current location - no line animation shown.
   * Fits the bounds to the current active location 
   * (or line segment, if animating), and the location at the given index.
   *
   * @method setCurrentIndex
   * @param {number} index The index of the location to set the path to.
   * @param {Function} onTransitionComplete (Optional) The callback to invoke on
   * the completion of the transition.
   */
  setCurrentIndex: function(index, onTransitionComplete) {
    this.finishAnimation(false);
    var prevPath = this._prevLine.getPath().getArray().slice();
    var nextPath = this._nextLine.getPath().getArray().slice();
    var locations = [nextPath.pop()];
    var totalPath = prevPath.concat(nextPath.reverse());
    index = index < 0 ? 0 : Math.min(index, totalPath.length - 1);
    // Previous line path contains the points up to and including index
    this._prevLine.setPath(totalPath.slice(0, index + 1));
    // Next line path contains the points from the end to the index (inclusive)
    // The path is reversed with the first point being the end of the total path
    this._nextLine.setPath(totalPath.slice(index).reverse());

    locations.push(totalPath[index]);
    this._mapTransitionManager.fitBounds(locations, true, onTransitionComplete);
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
    if (this.isIdle() || this._forward) return index;
    return index - 1;
  },

  /**
   * Gets the length of the total path.
   *
   * @method get length
   * @returns {number} The length of the total path.
   */
  get length() {
    var length = this._prevLine.getPath().length +
        this._nextLine.getPath().length - 1;
    if (length < 0) return 0;
    return this.isIdle() ? length : (length - 1);
  },

  /**
   * Gets the heading of the line animation.
   * Heading is:
   *  -1 : Heading towards the previous location.
   *   0 : If the manager is idle, i.e. there is no animation.
   *   1 : Heading towards the next location.
   *
   * @method getHeadingOfAnimation
   * @returns {number} The heading of the animation.
   */
  getHeadingOfAnimation: function() {
    if (this.isIdle()) return 0;
    return this._forward ? 1 : -1;
  },

  /**
   * Checks if the manager is idle.
   * It is idle if there are no line animations currently in progress or paused.
   *
   * @method isIdle
   * @returns {boolean} True if the transition manager is idle.
   */
  isIdle: function() {
    return (this._state === TransitionState.IDLE);
  },

  /**
   * Clears the path and stops any animations in progress.
   *
   * @method clear
   */
  clear: function() {
    this._cancelAnimation();
    this._prevLine.getPath().clear();
    this._nextLine.getPath().clear();
    this._mapTransitionManager.removeIdleBehavior();
    this._state = TransitionState.IDLE;
  },

  /**
   * Checks if the path is empty.
   *
   * @method isEmpty
   * @returns {boolean} True if the path is empty.
   */
  isEmpty: function() {
    return (this.length < 1);
  },

  /**
   * Inserts the location at the given index.
   *
   * @method insertAt
   * @param {number} index The index at which to insert the location.
   * Note: If the index < 0, it inserts at the beginning of the path.
   * If the index > last index, it inserts the point at the end of the path.
   * @param {google.maps.LatLng} location The location to insert.
   */
  insertAt: function(index, location) {
    if (!location) return;
    var currentIndex = this._prevLine.getPath().length - 1;
    if (currentIndex < 0) {  // If it is the first point to be inserted.
      this._prevLine.getPath().insertAt(0, location);
      this._nextLine.getPath().insertAt(0, location);
    } else if (index > currentIndex) {
      index = this._nextLine.getPath().length + currentIndex - index;
      if (!this.isIdle()) --index;
      this._nextLine.getPath().insertAt(index, location);
    } else {
      this._prevLine.getPath().insertAt(index, location);
    }
    this._panToAnimatingLineSegment();
  },

  /**
   * Sets the location at the given index.
   * Note: if the index is out of range [0, last index], it does nothing.
   *
   * @method setAt
   * @param {number} index The positive index at which to set the location.
   * @param {!google.maps.LatLng} location The location to set.
   */
  setAt: function(index, location) {
    if (!location) return;
    var currentIndex = this._prevLine.getPath().length - 1;
    if (index === currentIndex && this.isIdle()) {
      setLast(this._prevLine, location);
      setLast(this._nextLine, location);
      this._mapTransitionManager.panTo(location);
    } else if (index < currentIndex) {
      this._prevLine.getPath().setAt(index, location);
    } else {
      index = this._nextLine.getPath().length - 1 + currentIndex - index;
      if (!this.isIdle()) --index;
      this._nextLine.getPath().setAt(index, location);
    }
    this._panToAnimatingLineSegment();
  },

  /**
   * Removes the location at the given index.
   * Note: Throws errors if:
   *   - the manager is idle and the current location is removed.
   *   - if it is the last (or first) location and the manager is animating
   *     from/to this location.
   *
   * @method removeAt
   * @param {number} index The index at which to remove the location.
   * Note: If the index < 0, it removes at the beginning of the path.
   * If the index > last index, it does nothing.
   */
  removeAt: function(index) {
    var totalLength = this.length;
    if (index < 0) index = 0;
    var currentIndex = this._prevLine.getPath().length - 1;
    if (this.isIdle() && index === currentIndex) {
      if (totalLength > 1) {
        throw new Error('Cannot remove the current location');
      }
      // If it is the last remaining scene, remove it.
      this.clear();
    } else if (!this.isIdle() && ((index < 1 && index === currentIndex - 1) ||
        (index === currentIndex && index === totalLength - 1))) {
      throw new Error('Cannot remove an endpoint which is used in the ' +
          'current animation.');
    } else if (index > currentIndex) {
      index = totalLength - index - 1;
      if (!this.isIdle()) --index;
      this._nextLine.getPath().removeAt(index);
    } else {
      this._prevLine.getPath().removeAt(index);
    }
    this._panToAnimatingLineSegment();
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
   * Animates the line to the next location.
   *
   * @method next
   * @param {Function} onTransitionComplete (Optional) The callback to invoke on
   * the completion of the map transition and line animation.
   */
  next: function(onTransitionComplete) {
    if (!this.hasNext()) return;
    this._startAnimation(true, onTransitionComplete);
  },

  /**
   * Animates the line to the previous location.
   *
   * @method prev
   * @param {Function} onTransitionComplete (Optional) The callback to invoke on
   * the completion of the map transition and line animation.
   */
  prev: function(onTransitionComplete) {
    if (!this.hasPrev()) return;
    this._startAnimation(false, onTransitionComplete);
  },

  /**
   * Pauses the polyline animation (if there is an animation in progress).
   *
   * @method pause
   */
  pause: function() {
    if (this.isIdle()) return;
    this._state = TransitionState.PAUSED;
    this._cancelAnimation();
    this._mapTransitionManager.removeIdleBehavior();
  },

  /**
   * Pans to the animating line segment if the line is currently animating.
   *
   * @method _panToAnimatingLineSegment
   */
  _panToAnimatingLineSegment: function() {
    if (this._state != TransitionState.ANIMATING) return;
    this._mapTransitionManager.fitBounds([getPointOnLine(this._prevLine, - 2),
        getPointOnLine(this._nextLine, - 2)], false);
  },

  /**
   * Starts a line animation moving to the next, or the previous.
   * If another line animation/transition is in progress, stop it.
   *
   * @method _startAnimation
   * @param {boolean} forward If true, animates to the next location, otherwise
   * animates to the previous location.
   * @param {Function} onTransitionComplete (Optional) The callback to invoke on
   * the completion of the map transition and line animation.
   */
  _startAnimation: function(forward, onTransitionComplete) {
    this._mapTransitionManager.removeIdleBehavior();
    if (this._state === TransitionState.ANIMATING) {
      if (forward === this._forward) this.finishAnimation(false);
      else this.pause();
    }
    this._forward = forward;
    var resume = (this._state === TransitionState.PAUSED);
    if (!resume) {
      var line = this._forward ? this._prevLine : this._nextLine;
      line.getPath().push(getPointOnLine(line, - 1));
    }
    this._state = TransitionState.ANIMATING;
    this._panToAnimatingLineSegment();
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
   */
  _cancelAnimation: function() {
    if (this.isIdle()) return;
    window.cancelAnimationFrame(this._intervalId);
    this._intervalId = null;
  },

  /**
   * Completes the current line animation, if there is one in progress.
   *
   * @method finishAnimation
   * @param {boolean} finishTransition If true, finishes default transition.
   * @param {Function} onTransitionComplete (Optional) The callback to invoke on
   * the completion of the transition. If finishTransition is true, it is
   * invoked on the completion of the pan, else once the animation is finished.
   */
  finishAnimation: function(finishTransition, onTransitionComplete) {
    if (this.isIdle()) return;
    this._cancelAnimation();
    this._state = TransitionState.IDLE;
    var shortenLine = (this._forward && this._nextLine) || this._prevLine;
    shortenLine.getPath().pop();
    var currentLoc = getPointOnLine(shortenLine, - 1);
    var line = this._forward ? this._prevLine : this._nextLine;
    setLast(line, currentLoc);
    if (finishTransition) {
      this._mapTransitionManager.panTo(currentLoc, onTransitionComplete);
    } else if (onTransitionComplete) {
      onTransitionComplete();
    }
  }
}
