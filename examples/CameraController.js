

/**
* Class: PlanarControl
* Description: Camera controls adapted for a planar view.
* Left mouse button translates the camera on the horizontal (xy) plane.
* Right mouse button rotates around the camera's focus point.
* Scroll wheel zooms toward cursor position.
* Middle mouse button (wheel click) "smart zooms" at cursor location.
* S : go to start view
* T : go to top view
*/

THREE = itowns.THREE;

//event keycode
const keys = { CTRL: 17, R: 82, O: 79, F: 70, S: 83, P: 80, T: 84, M: 77, UP : 38, DOWN : 40, RIGHT : 39, LEFT : 37 };
const mouseButtons = { LEFTCLICK: THREE.MOUSE.LEFT, MIDDLECLICK: THREE.MOUSE.MIDDLE, RIGHTCLICK: THREE.MOUSE.RIGHT };

//control state
const STATE = { NONE: -1, PAN: 0, TRANSLATE: 1, ROTATE: 2, PANUP: 3, TRAVEL: 4 };

let state = STATE.NONE;
let isCtrlDown = false;

//starting camera position
let camStartPos = new THREE.Vector3();

//mouse movement
let lastMousePos = new THREE.Vector2();
let deltaMousePos = new THREE.Vector2(0,0);

//camera translation
let panCamStart = new THREE.Vector3();
let panStart = new THREE.Vector3();
let panEnd = new THREE.Vector3();
let panDelta = new THREE.Vector3();

//camera focus point : ground point at screen center
let centerPoint = new THREE.Vector3(0,0,0);

//camera rotation
let theta = 0.0;
let phi = 0.0;
let thetaDelta = 0;
let phiDelta = 0;

//debug shape
let debugCube = new THREE.Mesh( new THREE.BoxGeometry( 50, 50, 50 ), new THREE.MeshBasicMaterial( {color: 0x00ff00, wireframe: true} ) );

//animated travel
let travelStarted = false;

let travelEndPos = new THREE.Vector3();
let targetLook = new THREE.Vector3();

let travelStartPos = new THREE.Vector3();
let travelStartRot = new THREE.Quaternion();
let travelEndRot = new THREE.Quaternion();

let travelAlpha = 0;
let travelDuration = 0;

let travelUseRotation = false;
let travelUseSmooth = false;

//time management
let deltaTime = 0;
let lastElapsedTime = 0;
const clock = new THREE.Clock();


class PlanarControl extends THREE.EventDispatcher{
  /**
  * Constructor
  * @param domElement : the webgl div (city visualization)
  * @param view : the itowns view (planar view)
  * @param extent : the itown extent
  * more parameters can be set by adding {param: value} after the 'extent' param, when creating the instance.
  * example : let controls = new PlanarControl(domElement, view, extent, {zoomTravelTime: 0.4, groundHeight: 200});
  */

  constructor(view, extent, options = {}) {

    //extra options : some parameters have default value but can be modified with this

    //  this = this;

    super();

    this.camera = view.camera.camera3D;
    this.domElement = view.mainLoop.gfxEngine.renderer.domElement;
    this.engine = view.mainLoop.engine;
    this.view = view;
    this.position = this.camera.position;
    this.rotation = this.camera.rotation;

    this.extent = extent;

    this.cityCenter = extent.center().xyz();

    //options

    this.startPosition = options.startPos || this.cityCenter.clone().add(new THREE.Vector3(3000,3000,2000));
    this.startLook = options.startLook || this.cityCenter;
    this.topViewAltitude = options.topViewAltitude || 10000;

    this.autoTravelTimeMin = options.autoTravelTimeMin || 1.5;
    this.autoTravelTimeMax = options.autoTravelTimeMax || 5;
    this.autoTravelTimeDist = options.autoTravelTimeDist || 30000;

    this.smartZoomHeightMin = options.smartZoomHeightMin || 100;
    this.smartZoomHeightMax = options.smartZoomHeightMax || 500;

    this.zoomTravelTime = options.zoomTravelTime || 0.2;

    this.zoomInFactor = options.zoomInFactor || 0.25;
    this.zoomOutFactor = options.zoomOutFactor || 0.4;

    this.instantTravel = options.instantTravel || false;

    this.rotateSpeed = options.rotateSpeed || 2;

    this.groundHeight = options.groundHeight || this.cityCenter.z;

    this.minZenithAngle = options.minZenithAngle || 0 * Math.PI / 180;

    // should be less than 90 deg (90 = parallel to the ground)
    this.maxZenithAngle = options.maxZenithAngle || 80 * Math.PI / 180;

    // if debug is true, a wireframe cube is displayed in the scene
    this.debug = options.debug || false;

    //starting camera position & rotation
    this.position.copy(this.startPosition);
    this.camera.lookAt(this.startLook);

    //prevent the default contextmenu from appearing when right-clicking
    //this allows to use right-click for input without the menu appearing
    this.domElement.addEventListener('contextmenu', onContextMenu.bind(this), false);

    //event listeners for user input
    this.addInputListeners();

    console.log("inputlisteners");

    //DEBUG
    if(this.debug===true){
      this.view.scene.add(debugCube);
      debugCube.position.copy(options.startLook || this.cityCenter);
      debugCube.updateMatrixWorld();
    }

    //add this PlanarControl instance to the view's framerequesters
    //with this, PlanarControl.update() will be called each frame
    this.view.addFrameRequester(this);
  }

  //PlanarControl.prototype = Object.create(THREE.EventDispatcher.prototype);
  //PlanarControl.prototype.constructor = PlanarControl;

  /**
  * smoothing function (sigmoid) : based on h01 Hermite function
  * returns a value between 0 and 1
  * @param x : the value to be smoothed, between 0 and 1
  */
  smooth(x) {

    //between 1.0 and 1.5
    const p = 1.33;

    const smoothed = Math.pow((x*x*(3-2*x)),p);

    return smoothed;

  }

  /**
  * return the mouse pixel position (x,y) on screen as a vector2
  * @param event : the mouse event
  */
  getMousePos(event) {

    const mousePos = new THREE.Vector2(event.clientX,event.clientY);


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
  startTravel(targetPos, travelTime, targetOrientation, useSmooth) {

    //control state
    state=STATE.TRAVEL;

    //update cursor
    this.updateCursorType();

    //prevent input
    this.removeInputListeners();

    travelUseRotation = (targetOrientation==="none")? false : true ;
    travelUseSmooth = useSmooth;

    //start position (current camera position)
    travelStartPos.copy(this.position);

    //start rotation (current camera rotation)
    travelStartRot.copy( this.camera.quaternion );

    //setup the end rotation :

    //case where targetOrientation is a quaternion
    if(typeof targetOrientation.w !== 'undefined'){

      travelEndRot.copy(targetOrientation);

    }
    //case where targetOrientation is a vector3
    else if(targetOrientation.isVector3){

      if(targetPos === targetOrientation){

        this.camera.lookAt( targetOrientation );
        travelEndRot.copy( this.camera.quaternion );
        this.camera.quaternion.copy(travelStartRot);
      }
      else {

        this.position.copy(targetPos);
        this.camera.lookAt( targetOrientation );
        travelEndRot.copy( this.camera.quaternion );
        this.camera.quaternion.copy(travelStartRot);
        this.position.copy(travelStartPos);
      }

    }

    //end position
    travelEndPos.copy(targetPos);


    //travel duration setup :

    if(this.instantTravel){

      travelDuration = 0;
    }
    else{

      //case where travelTime is set to "auto" : travelDuration will be a value between autoTravelTimeMin and autoTravelTimeMax
      //depending on travel distance and travel angular difference
      if(travelTime==="auto"){

        //a value between 0 and 1 according to the travel distance. Adjusted by autoTravelTimeDist parameter
        const normalizedDistance = Math.min(1,targetPos.distanceTo(this.position)/this.autoTravelTimeDist);

        travelDuration = THREE.Math.lerp(this.autoTravelTimeMin,this.autoTravelTimeMax,normalizedDistance);

        //if travel changes camera orientation, travel duration is adjusted according to angularDifference
        //this allows for a smoother travel (more time for the camera to rotate)
        //final duration will not excede autoTravelTimeMax
        if(travelUseRotation){

          //value is normalized between 0 and 1
          const angularDifference = 0.5-0.5*(travelEndRot.normalize().dot(this.camera.quaternion.normalize()));

          travelDuration *= 1 + 2*angularDifference;

          travelDuration = Math.min(travelDuration,this.autoTravelTimeMax);

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

    this.update();

  }

  /**
  * resume normal behavior after a travel is completed
  */
  endTravel() {

    this.position.copy(travelEndPos);

    if(travelUseRotation){
      this.camera.quaternion.copy(travelEndRot);
    }

    this.addInputListeners();

    state = STATE.NONE;

    this.updateCursorType();

    this.update();

  }

  /**
  * handle the animated movement and rotation of the camera in "travel" state
  * @param dt : the deltatime between two updates
  */
  handleTravel(dt) {

    if(!travelStarted){
      travelStarted = true;
      return;
    }

    travelAlpha += dt / travelDuration;

    //the animation alpha, between 0 (start) and 1 (finish)
    const alpha = (travelUseSmooth)? this.smooth(travelAlpha) : travelAlpha;

    //new position
    this.position.lerpVectors(travelStartPos, travelEndPos, alpha);

    //new rotation
    if(travelUseRotation===true){
      THREE.Quaternion.slerp(travelStartRot, travelEndRot, this.camera.quaternion, alpha);
    }

    //completion test
    if(travelAlpha > 1){
      this.endTravel();
    }

  }

  /**
  * PlanarControl update  : called each frame
  * updates the view and camera if needed, and handles the animated travel
  */
  update() {

    deltaTime = clock.getElapsedTime() - lastElapsedTime;
    lastElapsedTime = clock.getElapsedTime();

    if(state===STATE.TRAVEL){

      this.handleTravel(deltaTime);

    }


    //if something has changed
    if(state!==STATE.NONE){

      this.view.camera.update(window.innerWidth, window.innerHeight);

      this.view.notifyChange(true);

    }

  }

  /**
  * returns the point (xyz) under the mouse cursor in 3d space (world space)
  * the point belong to an abstract mathematical plane of specified height (doesnt use actual geometry)
  * this will work even when the cursor is over nothing (out of city limits)
  * @param posXY : the mouse position in screen space (unit : pixel)
  * @param height : the height of the mathematical plane (ground height)
  */
  get3DPointUnderCursor(posXY, height) {

    let vector = new THREE.Vector3();

    vector.set(
      ( posXY.x / window.innerWidth ) * 2 - 1,
      - ( posXY.y / window.innerHeight ) * 2 + 1,
      0.5 );

      vector.unproject( this.camera );

      const dir = vector.sub( this.position ).normalize();

      const distance = (height - this.position.z) / dir.z;

      const pos = this.position.clone().add( dir.multiplyScalar( distance ) );

      if(this.debug===true){
        debugCube.position.copy(pos);
        debugCube.updateMatrixWorld();
      }

      return pos;

    }


    /**
    * returns the point (xyz) under the mouse cursor in 3d space (world space)
    * if geometry is under the cursor, the point in obtained with getPickingPositionFromDepth
    * if no geometry is under the cursor, the point is obtained with get3DPointUnderCursor
    * @param posXY : the mouse position in screen space (unit : pixel)
    */
    get3DPointAtScreenXY(posXY) {

      //the returned value
      let result = new THREE.Vector3();

      //check if there is valid geometry under cursor
      if(typeof this.view.getPickingPositionFromDepth(posXY) !== 'undefined'){
        result.copy(this.view.getPickingPositionFromDepth(posXY));
      }
      //if not, we use the mathematical plane at height = groundHeight
      else{
        result.copy(this.get3DPointUnderCursor(posXY, this.groundHeight));
      }

      return result;

    }


    /**
    * Initiate a pan movement (translation on xy plane) when user does a left-click
    * The movement value is derived from the actual world point under the mouse cursor
    * This allows the user to "grab" a world point and drag it to move (eg : google map)
    * @param event : the mouse down event.
    */
    handleMouseDownPan(event) {

      //the world point under mouse cursor when the pan movement is started
      panStart.copy(this.get3DPointAtScreenXY(this.getMousePos(event)));

      //the difference between start and end cursor position
      panDelta.set(0,0,0);

    }

    /**
    * Handle the pan movement (translation on xy plane) when user moves the mouse
    * The pan movement is previously initiated when user does a left-click, by handleMouseDownPan()
    * Compute the pan value and update the camera controls.
    * The movement value is derived from the actual world point under the mouse cursor
    * This allows the user to "grab" a world point and drag it to move (eg : google map)
    * @param event : the mouse move event.
    */
    handleMouseMovePan(event) {

      //the world point under the current mouse cursor position, at same height than panStart
      panEnd.copy(this.get3DPointUnderCursor(this.getMousePos(event),panStart.z));

      //the difference between start and end cursor position
      panDelta.subVectors(panEnd,panStart);

      //new camera position

      this.position.sub(panDelta);

      //request update
      this.update();
    }

    /**
    * Triggers a "smart zoom" animated movement (travel) toward the point under mouse cursor
    * The camera will be smoothly moved and oriented close to the target, at a determined height and distance
    * @param event : the mouse wheel click (middle mouse button) event.
    */
    smartZoom(event) {

      //point under mouse cursor
      const pointUnderCursor = this.get3DPointAtScreenXY(this.getMousePos(event));

      //direction of the movement, projected on xy plane and normalized
      let dir = new THREE.Vector3();
      dir.copy(pointUnderCursor).sub(this.position);
      dir.z = 0;
      dir.normalize();

      const distanceToPoint = this.position.distanceTo(pointUnderCursor);

      //camera height (altitude) at the end of the travel
      const targetHeight = THREE.Math.lerp(this.smartZoomHeightMin, this.smartZoomHeightMax, Math.min(distanceToPoint/5000,1)); ;

      //camera position at the end of the travel
      let moveTarget = new THREE.Vector3();

      moveTarget.copy(pointUnderCursor).add(dir.multiplyScalar(-targetHeight*2));
      moveTarget.z = pointUnderCursor.z + targetHeight;

      //debug
      if(this.debug===true){
        debugCube.position.copy(moveLook);
        debugCube.updateMatrixWorld();
      }

      //initiate the travel
      this.startTravel(moveTarget,"auto", pointUnderCursor, true);

    }

    /**
    * Initiate a rotate (orbit) movement when user does a right-click or ctrl
    * @param event : the mouse down event.
    */
    initiateRotate() {

      //view.removeFrameRequester(controls);

      //initiate rotation
      const screenCenter = new THREE.Vector2(0.5*window.innerWidth,0.5*window.innerHeight);

      centerPoint.copy(this.get3DPointAtScreenXY(screenCenter));

      const r = this.position.distanceTo(centerPoint);
      phi = Math.acos((this.position.z-centerPoint.z) / r);

      if(this.debug===true){
        debugCube.position.copy(centerPoint);
        debugCube.updateMatrixWorld();
      }

      state = STATE.ROTATE;

    }

    /**
    * Handle the rotate movement (orbit) when user moves the mouse
    * the movement is an orbit around "centerPoint", the camera focus point (ground point at screen center)
    * The rotate movement is previously initiated in initiateRotate()
    * Compute the new position value and update the camera controls.
    */
    handleMouseMoveRotate() {

      //angle deltas
      //deltaMousePos is computed in onMouseMove / onMouseDown s
      thetaDelta = -this.rotateSpeed*deltaMousePos.x/window.innerWidth;
      phiDelta = -this.rotateSpeed*deltaMousePos.y/window.innerHeight;

      //the vector from centerPoint (focus point) to camera position
      const offset = this.position.clone().sub(centerPoint);

      const quat = new THREE.Quaternion().setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 0, 1));
      const quatInverse = quat.clone().inverse();

      if (thetaDelta !== 0 || phiDelta !== 0) {
        if ((phi + phiDelta >= this.minZenithAngle)
        && (phi + phiDelta <= this.maxZenithAngle)
        && phiDelta !== 0) {

          //rotation around X (altitude)

          phi += phiDelta;

          offset.applyQuaternion(quat);

          let rotationXQuaternion = new THREE.Quaternion();
          let vector = new THREE.Vector3();

          vector.setFromMatrixColumn(this.camera.matrix, 0);
          rotationXQuaternion.setFromAxisAngle(vector, phiDelta);
          offset.applyQuaternion(rotationXQuaternion);
          offset.applyQuaternion(quatInverse);

        }
        if (thetaDelta !== 0) {

          //rotation around Z (azimuth)

          let rotationZQuaternion = new THREE.Quaternion();
          rotationZQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), thetaDelta);
          offset.applyQuaternion(rotationZQuaternion);
        }
      }

      this.position.copy(offset).add(centerPoint);

      this.camera.lookAt(centerPoint);

      //requestupdate;
      this.update();

    }


    /**
    * Triggers an animated movement (travel) to set the camera to top view
    * Camera will be moved above cityCenter at a 10km altitude, looking at cityCenter
    */
    goToTopView() {

      let topViewPos = new THREE.Vector3();
      let targetQuat = new THREE.Quaternion();

      targetQuat.setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), 0*Math.PI / 2 );

      //the final position
      topViewPos.set(this.cityCenter.x, this.cityCenter.y, this.topViewAltitude);

      //initiate the travel
      this.startTravel(topViewPos,"auto",targetQuat,true);

    }

    /**
    * Triggers an animated movement (travel) to set the camera to starting view
    */
    goToStartView() {

      this.startTravel(this.startPosition,"auto",this.startLook,true);

    }





    /**
    * Triggers a Zoom animated movement (travel) toward the point under mouse cursor
    * The camera will be moved toward / away from the point under mouse cursor
    * The zoom intensity leties according to the distance to the point.
    * The closer to the ground, the lower the intensity
    * This means that user can zoom infinitly closer to the ground, but cannot go through it
    * Orientation will not change (TO DO : test with orientation change)
    * @param event : the mouse wheel event.
    */
    startZoom(event) {

      let delta;

      //mousewheel delta
      if (event.wheelDelta !== undefined) {
        delta = event.wheelDelta;
      } else if (event.detail !== undefined) {
        delta = -event.detail;
      }

      const pointUnderCursor = this.get3DPointAtScreenXY(this.getMousePos(event));

      let newPos = new THREE.Vector3();

      //Zoom IN
      if(delta>0){

        //debug
        if(this.debug===true){
          debugCube.position.copy(pointUnderCursor);
          debugCube.updateMatrixWorld();
        }

        //target position
        newPos.lerpVectors(this.position,pointUnderCursor,this.zoomInFactor);

        //initiate travel
        this.startTravel(newPos,this.zoomTravelTime, "none", false);

      }
      //Zoom OUT
      else if(delta<0 && this.position.z < this.topViewAltitude){

        //debug
        if(this.debug===true){
          debugCube.position.copy(pointUnderCursor);
          debugCube.updateMatrixWorld();
        }

        //target position
        newPos.lerpVectors(this.position,pointUnderCursor,-1*this.zoomOutFactor);

        //initiate travel
        this.startTravel(newPos,this.zoomTravelTime, "none", false);

      }

    }




    /**
    * Remove all input listeners (block user input)
    */
    removeInputListeners() {

      //* *********************Keys***********************//
      window.removeEventListener('keydown', onKeyDown.bind(this), true);

      this.domElement.removeEventListener('mousedown', onMouseDown.bind(this), false);
      this.domElement.removeEventListener('mousewheel', onMouseWheel.bind(this), false);
      // For firefox
      this.domElement.removeEventListener('MozMousePixelScroll', onMouseWheel.bind(this), false);

    }

    /**
    * Add all input listeners (enable user input)
    */
    addInputListeners() {

      //* *********************Keys***********************//
      window.addEventListener('keydown', onKeyDown.bind(this), true);

      this.domElement.addEventListener('mousedown', onMouseDown.bind(this), false);

      this.domElement.addEventListener('mousewheel', onMouseWheel.bind(this), false);
      // For firefox
      this.domElement.addEventListener('MozMousePixelScroll', onMouseWheel.bind(this), false);

      console.log("pppppppppppppppp");
    }

    /**
    * update the cursor image according to the control state
    */
    updateCursorType() {

      if(state===STATE.NONE){
        this.domElement.style.cursor = "auto";
      }
      else if(state===STATE.PAN){
        this.domElement.style.cursor = "move";
      }
      else if(state===STATE.TRAVEL){
        this.domElement.style.cursor = "wait";
      }
      else if(state===STATE.ROTATE){
        this.domElement.style.cursor = "move";
      }

    }

  }

  /**
  * Catch and manage the event when a touch on the mouse is down.
  * @param event: the current event (mouse left button clicked or mouse wheel button actionned)
  */
  function onMouseDown (event) {

    event.preventDefault();

    lastMousePos.copy(this.getMousePos(event));

    if (event.button === mouseButtons.LEFTCLICK) {

      if (isCtrlDown) {
        this.initiateRotate();
      } else {
        this.handleMouseDownPan(event);
        state = STATE.PAN;
      }
    } else if (event.button === mouseButtons.MIDDLECLICK) {
      this.smartZoom(event);
    } else if (event.button === mouseButtons.RIGHTCLICK) {
      this.initiateRotate();
    }

    if (state !== STATE.NONE) {
      this.domElement.addEventListener('mousemove', onMouseMove.bind(this), false);
      this.domElement.addEventListener('mouseup', onMouseUp.bind(this), false);
    }

    this.updateCursorType();
  }



  /**
  * Catch the event when a touch on the mouse is uped. Reinit the state of the controller and disable.
  * the listener on the move mouse event.
  * @param event: the current event
  */
  function onMouseUp(event) {

    event.preventDefault();

    this.domElement.removeEventListener('mousemove', onMouseMove.bind(this), false);
    this.domElement.removeEventListener('mouseup', onMouseUp.bind(this), false);

    panDelta.set(0,0,0);

    if(state!==STATE.TRAVEL){
      state = STATE.NONE;
      //view.addFrameRequester(controls);
    }

    this.updateCursorType();
  }

  /**
  * Catch and manage the event when the mouse is moved, depending of the current state of the controller.
  * Can be called when the state of the controller is different of NONE.
  * @param event: the current event
  */
  function onMouseMove(event) {

    event.preventDefault();

    deltaMousePos.copy(this.getMousePos(event)).sub(lastMousePos);

    lastMousePos.copy(this.getMousePos(event));

    if (state === STATE.ROTATE)
    { this.handleMouseMoveRotate(event); }
    else if (state === STATE.PAN)
    { this.handleMouseMovePan(event); }
    else if (state === STATE.PANUP)
    { /*this.handleMouseMovePan(event);*/ }
  }


  /**
  * Catch and manage the event when a key is up.
  * @param event: the current event
  */
  function onKeyUp(event) {

    if (event.keyCode == keys.CTRL) {
      isCtrlDown = false;
      this.domElement.removeEventListener('keyup', onKeyUp.bind(this), true);
    }
  }




  /**
  * Catch and manage the event when a key is down.
  * @param event: the current event
  */
  function onKeyDown(event) {

    if (event.keyCode === keys.T) {
      this.goToTopView();
    }
    if (event.keyCode === keys.S) {
      console.log(this);
      this.goToStartView();
    }
    if (event.keyCode === keys.CTRL) {
      isCtrlDown = true;
    }

    this.domElement.addEventListener('keyup', this.onKeyUp, true);

  }

  /**
  * Catch and manage the event when the mouse wheel is rolled.
  * @param event: the current event
  */
  function onMouseWheel(event) {

    event.preventDefault();
    event.stopPropagation();

    if(state===STATE.NONE){
      this.startZoom(event);
    }

  }


  /**
  * Catch and manage the event when the context menu is called (by a right click on the window).
  * We use this to prevent the context menu from appearing, so we can use right click for other inputs.
  * @param event: the current event
  */
  function onContextMenu(event) {
    event.preventDefault();

  }
