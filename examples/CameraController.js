/**
* Class: CameraController
* Description: Camera controls adapted for a planar view.
* Left mouse button translates the camera on the horizontal (xy) plane.
* Right mouse button rotates around the camera's focus point.
* Scroll wheel zooms toward cursor position.
* Middle mouse button (wheel click) "smart zooms" at cursor location.
* S : go to start view
* T : go to top view
*/

THREE = itowns.THREE;

//scope
var _this = null;

//event keycode
var keys = { CTRL: 17, R: 82, O: 79, F: 70, S: 83, P: 80, T: 84, M: 77, UP : 38, DOWN : 40, RIGHT : 39, LEFT : 37 };
var mouseButtons = { LEFTCLICK: THREE.MOUSE.LEFT, MIDDLECLICK: THREE.MOUSE.MIDDLE, RIGHTCLICK: THREE.MOUSE.RIGHT };

//control state
var STATE = { NONE: -1, PAN: 0, TRANSLATE: 1, ROTATE: 2, PANUP: 3, TRAVEL: 4 };
var state = STATE.NONE;
var isCtrlDown = false;
var select = false;


//starting camera position
var camStartPos = new THREE.Vector3();

//mouse movement
var lastMousePos = new THREE.Vector2();
var deltaMousePos = new THREE.Vector2(0,0);

//new camera position when moving
var nextPosition = new THREE.Vector3();

//camera translation
var panCamStart = new THREE.Vector3();
var panStart = new THREE.Vector3();
var panEnd = new THREE.Vector3();
var panDelta = new THREE.Vector3();

//camera focus point : ground point at screen center
var centerPoint = new THREE.Vector3(0,0,0);

//camera rotation
var theta = 0.0;
var phi = 0.0;
var thetaDelta = 0;
var phiDelta = 0;

//debug shape
var debugCube = new THREE.Mesh( new THREE.BoxGeometry( 50, 50, 50 ), new THREE.MeshBasicMaterial( {color: 0x00ff00, wireframe: true} ) );

//animated travel
var travelStarted = false;

var travelEndPos = new THREE.Vector3();
var targetLook = new THREE.Vector3();

var travelStartPos = new THREE.Vector3();
var travelStartRot = new THREE.Quaternion();
var travelEndRot = new THREE.Quaternion();

var travelAlpha = 0;
var travelDuration = 0;

var travelUseRotation = false;
var travelUseSmooth = false;

//time management
var deltaTime = 0;
var lastElapsedTime = 0;
var clock = new THREE.Clock();

//document support
var currentDocIndex;
var currentDocData;


/**
* Constructor
* @param domElement : the webgl div (city visualization)
* @param view : the itowns view (planar view)
* @param extent : the itown extent
* more parameters can be set by adding {param: value} after the 'extent' param, when creating the instance.
* example : var controls = new CameraController(domElement, view, extent, {zoomTravelTime: 0.4, groundHeight: 200});
*/

function CameraController(domElement, view, extent) {

  //extra options : some parameters have default value but can be modified with this
  var options = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};

  _this = this;

  _this.camera = view.camera.camera3D;
  _this.domElement = view.mainLoop.gfxEngine.renderer.domElement;
  _this.engine = view.mainLoop.engine;
  _this.view = view;
  _this.position = _this.camera.position;
  _this.rotation = _this.camera.rotation;

  _this.extent = extent;

  _this.cityCenter = extent.center().xyz();

  //options

  _this.startPosition = options.startPos || _this.cityCenter.clone().add(new THREE.Vector3(3000,3000,2000));
  _this.startLook = options.startLook || _this.cityCenter;
  _this.topViewAltitude = options.topViewAltitude || 10000;

  _this.autoTravelTimeMin = options.autoTravelTimeMin || 1.5;
  _this.autoTravelTimeMax = options.autoTravelTimeMax || 5;
  _this.autoTravelTimeDist = options.autoTravelTimeDist || 30000;

  _this.smartZoomHeightMin = options.smartZoomHeightMin || 100;
  _this.smartZoomHeightMax = options.smartZoomHeightMax || 500;

  _this.zoomTravelTime = options.zoomTravelTime || 0.2;

  _this.zoomInFactor = options.zoomInFactor || 0.25;
  _this.zoomOutFactor = options.zoomOutFactor || 0.4;

  _this.instantTravel = options.instantTravel || false;

  _this.rotateSpeed = options.rotateSpeed || 2;

  _this.groundHeight = options.groundHeight || _this.cityCenter.y;

  _this.minZenithAngle = options.minZenithAngle || 0 * Math.PI / 180;

  // should be less than 90 deg (90 = parallel to the ground)
  _this.maxZenithAngle = options.maxZenithAngle || 80 * Math.PI / 180;

  // if debug is true, a wireframe cube is displayed in the scene
  _this.debug = options.debug || false;

  //starting camera position & rotation
  _this.position.copy(_this.startPosition);
  _this.camera.lookAt(_this.startLook);

  //prevent the default contextmenu from appearing when right-clicking
  //this allows to use right-click for input without the menu appearing
  _this.domElement.addEventListener('contextmenu', _this.onContextMenu, false);

  //event listeners for user input
  _this.addInputListeners();

  //DEBUG
  if(_this.debug===true){
    _this.view.scene.add(debugCube);
    debugCube.position.copy(options.startLook || _this.cityCenter);
    debugCube.updateMatrixWorld();
  }

  //add this CameraController instance to the view's framerequesters
  //with this, CameraController.update() will be called each frame
  _this.view.addFrameRequester(this);



}

CameraController.prototype = Object.create(THREE.EventDispatcher.prototype);
CameraController.prototype.constructor = CameraController;


/**
* smoothing function (sigmoid) : based on h01 Hermite function
* returns a value between 0 and 1
* @param x : the value to be smoothed, between 0 and 1
*/
CameraController.prototype.smooth = function smooth(x) {

  //between 1.0 and 1.5
  var p = 1.33;

  var smoothed = Math.pow((x*x*(3-2*x)),p);

  return smoothed;

}

/**
* return the mouse pixel position (x,y) on screen as a vector2
* @param event : the mouse event
*/
CameraController.prototype.getMousePos = function getMousePos(event) {

  var mousePos = new THREE.Vector2();
  mousePos.x = event.clientX;
  mousePos.y = event.clientY;

  return mousePos;

}

/**
* triggers an animated movement & rotation for the camera
* @param targetPos : the target position of the camera (reached at the end)
* @param travelTime : set to "auto", or set to a duration in seconds.
* if set to auto : travel time will be set to a duration between autoTravelTimeMin and autoTravelTimeMax
* according to the distance and the angular difference between start and finish.
* @param targetOrientation : define the target rotation of the camera
* if targetOrientation is "none" : the camera will keep its starting orientation
* if targetOrientation is a world point (Vector3) : the camera will lookAt() this point
* if targetOrientation is a quaternion : this quaternion will define the final camera orientation
*/
CameraController.prototype.startTravel = function startTravel(targetPos, travelTime, targetOrientation, useSmooth) {

  //control state
  state=STATE.TRAVEL;

  //update cursor
  _this.updateCursorType();

  //prevent input
  _this.removeInputListeners();

  travelUseRotation = (targetOrientation==="none")? false : true ;
  travelUseSmooth = useSmooth;

  //start position (current camera position)
  travelStartPos.copy(_this.position);

  //start rotation (current camera rotation)
  travelStartRot.copy( _this.camera.quaternion );

  //setup the end rotation :

  //case where targetOrientation is a quaternion
  if(typeof targetOrientation.w !== 'undefined'){

    travelEndRot.copy(targetOrientation);

  }
  //case where targetOrientation is a vector3
  else if(targetOrientation.isVector3){

    if(targetPos === targetOrientation){

      _this.camera.lookAt( targetOrientation );
      travelEndRot.copy( _this.camera.quaternion );
      _this.camera.quaternion.copy(travelStartRot);
    }
    else {

      _this.position.copy(targetPos);
      _this.camera.lookAt( targetOrientation );
      travelEndRot.copy( _this.camera.quaternion );
      _this.camera.quaternion.copy(travelStartRot);
      _this.position.copy(travelStartPos);
    }

  }

  //end position
  travelEndPos.copy(targetPos);


  //travel duration setup :

  if(_this.instantTravel){

    travelDuration = 0;
  }
  else{

    //case where travelTime is set to "auto" : travelDuration will be a value between autoTravelTimeMin and autoTravelTimeMax
    //depending on travel distance and travel angular difference
    if(travelTime==="auto"){

      //a value between 0 and 1 according to the travel distance. Adjusted by autoTravelTimeDist parameter
      var normalizedDistance = Math.min(1,targetPos.distanceTo(_this.position)/_this.autoTravelTimeDist);

      travelDuration = THREE.Math.lerp(_this.autoTravelTimeMin,_this.autoTravelTimeMax,normalizedDistance);

      //if travel changes camera orientation, travel duration is adjusted according to angularDifference
      //this allows for a smoother travel (more time for the camera to rotate)
      //final duration will not excede autoTravelTimeMax
      if(travelUseRotation){

        //value is normalized between 0 and 1
        var angularDifference = 0.5-0.5*(travelEndRot.normalize().dot(_this.camera.quaternion.normalize()));

        travelDuration *= 1 + 2*angularDifference;

        travelDuration = Math.min(travelDuration,_this.autoTravelTimeMax);

      }

    }
    //case where traveltime !== "auto" : travelTime is a duration in seconds given as parameter
    else{
      travelDuration = travelTime;
    }
  }

  //final setup
  travelAlpha = 0;
  travelStarted = false;

  _this.update();

}

/**
* resume normal behavior after a travel is completed
*/
CameraController.prototype.endTravel = function endTravel() {

  _this.position.copy(travelEndPos);

  if(travelUseRotation){
    _this.camera.quaternion.copy(travelEndRot);
  }

  _this.addInputListeners();

  state = STATE.NONE;

  _this.updateCursorType();

  _this.update();

}

/**
* handle the animated movement and rotation of the camera in "travel" state
* @param dt : the deltatime between two updates
*/
CameraController.prototype.handleTravel = function handleTravel(dt) {

  if(!travelStarted){
    travelStarted = true;
    return;
  }

  travelAlpha += dt / travelDuration;

  //the animation alpha, between 0 (start) and 1 (finish)
  var alpha = (travelUseSmooth)? _this.smooth(travelAlpha) : travelAlpha;

  //new position
  _this.position.lerpVectors(travelStartPos, travelEndPos, alpha);

  //new rotation
  if(travelUseRotation===true){
    THREE.Quaternion.slerp(travelStartRot, travelEndRot, _this.camera.quaternion, alpha);
  }

  //completion test
  if(travelAlpha > 1){
    _this.endTravel();
  }

}

/**
* CameraController update function : called each frame
* updates the view and camera if needed, and handles the animated travel
*/
CameraController.prototype.update = function update() {

  deltaTime = clock.getElapsedTime() - lastElapsedTime;
  lastElapsedTime = clock.getElapsedTime();

  if(state===STATE.TRAVEL){
    _this.handleTravel(deltaTime);
  }
  else if(state===STATE.PAN || state===STATE.TRANSLATE || state===STATE.ROTATE){

    //new camera position
    //_this.position.copy(nextPosition);

  }

  //if something has changed
  if(state!==STATE.NONE){

    _this.view.camera.update(window.innerWidth, window.innerHeight);

    _this.view.notifyChange(true);

  }

};

/**
* returns the point (xyz) under the mouse cursor in 3d space (world space)
* the point belong to an abstract mathematical plane of specified height (doesnt use actual geometry)
* this will work even when the cursor is over nothing (out of city limits)
* @param posXY : the mouse position in screen space (unit : pixel)
* @param height : the height of the mathematical plane (ground height)
*/
CameraController.prototype.get3DPointUnderCursor = function get3DPointUnderCursor(posXY, height) {

  var vector = new THREE.Vector3();

  vector.set(
    ( posXY.x / window.innerWidth ) * 2 - 1,
    - ( posXY.y / window.innerHeight ) * 2 + 1,
    0.5 );

    vector.unproject( _this.camera );

    var dir = vector.sub( _this.position ).normalize();

    var distance = (height - _this.position.z) / dir.z;

    var pos = _this.position.clone().add( dir.multiplyScalar( distance ) );

    if(_this.debug===true){
      debugCube.position.copy(pos);
      debugCube.updateMatrixWorld();
    }

    return pos;

  };


  /**
  * returns the point (xyz) under the mouse cursor in 3d space (world space)
  * if geometry is under the cursor, the point in obtained with getPickingPositionFromDepth
  * if no geometry is under the cursor, the point is obtained with get3DPointUnderCursor
  * @param posXY : the mouse position in screen space (unit : pixel)
  */
  CameraController.prototype.get3DPointAtScreenXY = function get3DPointAtScreenXY(posXY) {

    //the returned value
    var result = new THREE.Vector3();

    //check if there is valid geometry under cursor
    if(typeof _this.view.getPickingPositionFromDepth(posXY) !== 'undefined'){
      result.copy(_this.view.getPickingPositionFromDepth(posXY));
    }
    //if not, we use the mathematical plane at height = groundHeight
    else{
      result.copy(_this.get3DPointUnderCursor(posXY, _this.groundHeight));
    }

    return result;

  };


  /**
  * Initiate a pan movement (translation on xy plane) when user does a left-click
  * The movement value is derived from the actual world point under the mouse cursor
  * This allows the user to "grab" a world point and drag it to move (eg : google map)
  * @param event : the mouse down event.
  */
  CameraController.prototype.handleMouseDownPan = function handleMouseDownPan(event) {

    //the world point under mouse cursor when the pan movement is started
    panStart.copy(_this.get3DPointAtScreenXY(_this.getMousePos(event)));

    //the difference between start and end cursor position
    panDelta.set(0,0,0);

    //nextPosition.copy(_this.position);

  };

  /**
  * Handle the pan movement (translation on xy plane) when user moves the mouse
  * The pan movement is previously initiated when user does a left-click, by handleMouseDownPan()
  * Compute the pan value and update the camera controls.
  * The movement value is derived from the actual world point under the mouse cursor
  * This allows the user to "grab" a world point and drag it to move (eg : google map)
  * @param event : the mouse move event.
  */
  CameraController.prototype.handleMouseMovePan = function handleMouseMovePan(event) {

    //the world point under the current mouse cursor position, at same height than panStart
    panEnd.copy(_this.get3DPointUnderCursor(_this.getMousePos(event),panStart.z));

    //the difference between start and end cursor position
    panDelta.subVectors(panEnd,panStart);

    //new camera position

    _this.position.sub(panDelta);
    //nextPosition.copy(_this.position.clone().sub(panDelta));

    //request update
    _this.update();
  };

  /**
  * Triggers a "smart zoom" animated movement (travel) toward the point under mouse cursor
  * The camera will be smoothly moved and oriented close to the target, at a determined height and distance
  * @param event : the mouse wheel click (middle mouse button) event.
  */
  CameraController.prototype.smartZoom = function smartZoom(event) {

    //point under mouse cursor
    var pointUnderCursor = _this.get3DPointAtScreenXY(_this.getMousePos(event));

    //camera focus point (the lookAt target) at the end of the travel
    var moveLook = new THREE.Vector3();
    moveLook.copy(pointUnderCursor);

    //direction of the movement, projected on xy plane and normalized
    var dir = new THREE.Vector3();
    dir.copy(pointUnderCursor).sub(_this.position);
    dir.z = 0;
    dir.normalize();

    var distanceToPoint = _this.position.distanceTo(pointUnderCursor);

    //camera height (altitude) at the end of the travel
    var targetHeight = THREE.Math.lerp(this.smartZoomHeightMin, this.smartZoomHeightMax, Math.min(distanceToPoint/5000,1)); ;

    //camera position at the end of the travel
    var moveTarget = new THREE.Vector3();

    moveTarget.copy(pointUnderCursor).add(dir.multiplyScalar(-targetHeight*2));
    moveTarget.z = pointUnderCursor.z + targetHeight;

    //debug
    if(_this.debug===true){
      debugCube.position.copy(moveLook);
      debugCube.updateMatrixWorld();
    }

    //initiate the travel
    _this.startTravel(moveTarget,"auto", moveLook, true);

  };

  /**
  * Initiate a rotate (orbit) movement when user does a right-click or ctrl
  * @param event : the mouse down event.
  */
  CameraController.prototype.initiateRotate = function initiateRotate() {

    //view.removeFrameRequester(controls);

    //initiate rotation
    var screenCenter = new THREE.Vector2();
    screenCenter.x=0.5*window.innerWidth;
    screenCenter.y=0.5*window.innerHeight;
    centerPoint.copy(_this.get3DPointAtScreenXY(screenCenter));

    var r = _this.position.distanceTo(centerPoint);
    phi = Math.acos((_this.position.z-centerPoint.z) / r);

    if(_this.debug===true){
      debugCube.position.copy(centerPoint);
      debugCube.updateMatrixWorld();
    }

    //nextPosition.copy(_this.position);

    state = STATE.ROTATE;

  };

  /**
  * Handle the rotate movement (orbit) when user moves the mouse
  * the movement is an orbit around "centerPoint", the camera focus point (ground point at screen center)
  * The rotate movement is previously initiated in initiateRotate()
  * Compute the new position value and update the camera controls.
  */
  CameraController.prototype.handleMouseMoveRotate = function handleMouseMoveRotate() {

    //angle deltas
    //deltaMousePos is computed in onMouseMove / onMouseDown functions
    thetaDelta = -this.rotateSpeed*deltaMousePos.x/window.innerWidth;
    phiDelta = -this.rotateSpeed*deltaMousePos.y/window.innerHeight;

    //the vector from centerPoint (focus point) to camera position
    var offset = new THREE.Vector3();
    offset.copy(_this.position).sub(centerPoint);

    var quat = new THREE.Quaternion().setFromUnitVectors(_this.camera.up, new THREE.Vector3(0, 0, 1));
    var quatInverse = quat.clone().inverse();

    if (thetaDelta !== 0 || phiDelta !== 0) {
      if ((phi + phiDelta >= _this.minZenithAngle)
      && (phi + phiDelta <= _this.maxZenithAngle)
      && phiDelta !== 0) {

        //rotation around X (altitude)

        phi += phiDelta;

        offset.applyQuaternion(quat);

        var rotationXQuaternion = new THREE.Quaternion();
        var vector = new THREE.Vector3();

        vector.setFromMatrixColumn(_this.camera.matrix, 0);
        rotationXQuaternion.setFromAxisAngle(vector, phiDelta);
        offset.applyQuaternion(rotationXQuaternion);
        offset.applyQuaternion(quatInverse);

      }
      if (thetaDelta !== 0) {

        //rotation around Z (azimuth)

        var rotationZQuaternion = new THREE.Quaternion();
        rotationZQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), thetaDelta);
        offset.applyQuaternion(rotationZQuaternion);
      }
    }

    //new camera position
    //nextPosition.copy(offset).add(centerPoint);

    _this.position.copy(offset).add(centerPoint);

    _this.camera.lookAt(centerPoint);

    //requestupdate;
    _this.update();

  }

  /**
  * Triggers an animated movement (travel) to set the camera to top view
  * Camera will be moved above cityCenter at a 10km altitude, looking at cityCenter
  */
  CameraController.prototype.goToTopView = function goToTopView() {

    var topViewPos = new THREE.Vector3();
    var targetQuat = new THREE.Quaternion();


    targetQuat.setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), 0*Math.PI / 2 );

    //the final position
    topViewPos.set(_this.cityCenter.x, _this.cityCenter.y, _this.topViewAltitude);

    //initiate the travel
    _this.startTravel(topViewPos,"auto",targetQuat,true);

  }


  /**
  * Triggers an animated movement (travel) to set the camera to starting view
  */
  CameraController.prototype.goToStartView = function goToStartView() {


    _this.startTravel(_this.startPosition,"auto",_this.startLook,true);


  }


  /**
  * Triggers a Zoom animated movement (travel) toward the point under mouse cursor
  * The camera will be moved toward / away from the point under mouse cursor
  * The zoom intensity varies according to the distance to the point.
  * The closer to the ground, the lower the intensity
  * This means that user can zoom infinitly closer to the ground, but cannot go through it
  * Orientation will not change (TO DO : test with orientation change)
  * @param event : the mouse wheel event.
  */
  CameraController.prototype.startZoom = function startZoom(event) {

    //mousewheel delta
    if (event.wheelDelta !== undefined) {
      delta = event.wheelDelta;
    } else if (event.detail !== undefined) {
      delta = -event.detail;
    }

    //center of the screen, in screen space (xy)
    var screenCenter = new THREE.Vector2();
    screenCenter.x=0.5*window.innerWidth;
    screenCenter.y=0.5*window.innerHeight;

    //world point (xyz) under screen center
    var pointUnderScreenCenter = _this.get3DPointAtScreenXY(screenCenter);

    var pointUnderCursor = _this.get3DPointAtScreenXY(_this.getMousePos(event));

    var zoomTarget = new THREE.Vector3();
    zoomTarget.copy(pointUnderScreenCenter);
    zoomTarget.copy(pointUnderCursor);

    var newPos = new THREE.Vector3();

    //Zoom IN
    if(delta>0){

      //debug
      if(_this.debug===true){
        debugCube.position.copy(zoomTarget);
        debugCube.updateMatrixWorld();
      }

      //target position
      newPos.lerpVectors(_this.position,zoomTarget,_this.zoomInFactor);

      //initiate travel
      _this.startTravel(newPos,_this.zoomTravelTime, "none", false);

    }
    //Zoom OUT
    else if(delta<0 && _this.position.z < _this.topViewAltitude){

      //debug
      if(_this.debug===true){
        debugCube.position.copy(zoomTarget);
        debugCube.updateMatrixWorld();
      }

      //target position
      newPos.lerpVectors(_this.position,zoomTarget,-1*_this.zoomOutFactor);

      //initiate travel
      _this.startTravel(newPos,_this.zoomTravelTime, "none", false);

    }

  };

  /**
  * Catch and manage the event when the mouse wheel is rolled.
  * @param event: the current event
  */
  CameraController.prototype.onMouseWheel = function onMouseWheel(event) {

    event.preventDefault();
    event.stopPropagation();

    if(state===STATE.NONE){
      _this.startZoom(event);
    }

  };

  /**
  * Catch and manage the event when a touch on the mouse is down.
  * @param event: the current event (mouse left button clicked or mouse wheel button actionned)
  */
  CameraController.prototype.onMouseDown= function onMouseDown (event) {

    event.preventDefault();

    lastMousePos.copy(_this.getMousePos(event));

    if (event.button === mouseButtons.LEFTCLICK) {

  if (isCtrlDown) {
        _this.initiateRotate();
      } else {

        _this.handleMouseDownPan(event);
        state = STATE.PAN;
      }
    } else if (event.button === mouseButtons.MIDDLECLICK) {

      _this.smartZoom(event);


    } else if (event.button === mouseButtons.RIGHTCLICK) {

      _this.initiateRotate();
    }

    if (state !== STATE.NONE) {
      _this.domElement.addEventListener('mousemove', _this.onMouseMove, false);
      _this.domElement.addEventListener('mouseup', _this.onMouseUp, false);
    }

    _this.updateCursorType();
  };

  /**
  * Catch the event when a touch on the mouse is uped. Reinit the state of the controller and disable.
  * the listener on the move mouse event.
  * @param event: the current event
  */
  CameraController.prototype.onMouseUp = function onMouseUp(event) {

    event.preventDefault();

    _this.domElement.removeEventListener('mousemove', _this.onMouseMove, false);
    _this.domElement.removeEventListener('mouseup', _this.onMouseUp, false);

    panDelta.set(0,0,0);

    if(state!==STATE.TRAVEL){
      state = STATE.NONE;
      //view.addFrameRequester(controls);
    }

    _this.updateCursorType();
  };

  /**
  * Catch and manage the event when the mouse is moved, depending of the current state of the controller.
  * Can be called when the state of the controller is different of NONE.
  * @param event: the current event
  */
  CameraController.prototype.onMouseMove = function onMouseMove(event) {

    event.preventDefault();

    deltaMousePos.copy(_this.getMousePos(event)).sub(lastMousePos);

    lastMousePos.copy(_this.getMousePos(event));

    if (state === STATE.ROTATE)
    { _this.handleMouseMoveRotate(event); }
    else if (state === STATE.PAN)
    { _this.handleMouseMovePan(event); }
    else if (state === STATE.PANUP)
    { /*_this.handleMouseMovePan(event);*/ }
  };

  /**
  * Catch and manage the event when a key is down.
  * @param event: the current event
  */
  CameraController.prototype.onKeyDown = function onKeyDown(event) {

    if (event.keyCode === keys.T) {

      _this.goToTopView();

    }
    if (event.keyCode === keys.S) {

      _this.goToStartView();

    }
    if (event.keyCode === keys.CTRL) {
      isCtrlDown = true;

    }

    window.addEventListener('keyup', _this.onKeyUp, false);

  };

  /**
  * Catch and manage the event when a key is up.
  * @param event: the current event
  */
  CameraController.prototype.onKeyUp = function onKeyUp(event) {

    if (event.keyCode == keys.CTRL) {
      isCtrlDown = false;
      window.removeEventListener('keyup', _this.onKeyUp, false);
    }
  };

  /**
  * Catch and manage the event when the context menu is called (by a right click on the window).
  * We use _this to prevent the context menu from appearing, so we can use right click for other inputs.
  * @param event: the current event
  */
  CameraController.prototype.onContextMenu = function onContextMenu(event) {
    event.preventDefault();

  };

  /**
  * Remove all input listeners (block user input)
  */
  CameraController.prototype.removeInputListeners = function removeInputListeners() {

    //* *********************Keys***********************//
    window.removeEventListener('keydown', _this.onKeyDown, false);

    _this.domElement.removeEventListener('mousedown', _this.onMouseDown, false);
    _this.domElement.removeEventListener('mousewheel', _this.onMouseWheel, false);
    // For firefox
    _this.domElement.removeEventListener('MozMousePixelScroll', _this.onMouseWheel, false);

  };

  /**
  * Add all input listeners (enable user input)
  */
  CameraController.prototype.addInputListeners = function addInputListeners() {

    //* *********************Keys***********************//
    window.addEventListener('keydown', _this.onKeyDown, false);

    _this.domElement.addEventListener('mousedown', _this.onMouseDown, false);

    _this.domElement.addEventListener('mousewheel', _this.onMouseWheel, false);
    // For firefox
    _this.domElement.addEventListener('MozMousePixelScroll', _this.onMouseWheel, false);


  };

  /**
  * update the cursor image according to the control state
  */
  CameraController.prototype.updateCursorType = function updateCursorType() {

    if(state===STATE.NONE){

      _this.domElement.style.cursor = "auto";

    }
    else if(state===STATE.PAN){

      _this.domElement.style.cursor = "move";

    }
    else if(state===STATE.TRAVEL){

      _this.domElement.style.cursor = "wait";

    }
    else if(state===STATE.ROTATE){

      _this.domElement.style.cursor = "move";

    }

  };
