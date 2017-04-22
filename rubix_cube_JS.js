"use strict"

var canvas;
var gl;
var program;

// Number of vertices to draw in drawArray function
var NumVertices = 36;

// Absolute value of each coordinate of each vertex for center cube
var vertexPos = 0.5;

// Length of side of one of the cubelets
var sidelen = 2*vertexPos;

// Spacing between cubelets
var spacing = 1.1;

// Vertex and color buffers used for rendering
var points = [];
var colors = [];

// Spherical coordinate angles for rotating the cube
// Distinguished with THETA_START and PHI_START, which are for the camera
// dPHI and dTHETA are the incremental angles to add to THETA and PHI while rotating
var THETA = radians(45);
var PHI = radians(45);
var dTHETA = 0;
var dPHI = 0;

// For rotating whole cube with mouse
var AMORTIZATION = 0.95; // used to scale down PHI and THETA to produce fading motion
var heldDown = false; // checks if mouse button is held

// Camera distance from object
var cameraRadius = 20.0;

// For zooming in and out
var cameraRadiusMin = 12.5;
var cameraRadiusMax = 50.0;

// For the lookAt function (model-view matrix)
var eye = vec3(cameraRadius*Math.sin(PHI)*Math.sin(THETA),
            cameraRadius*Math.cos(PHI),
            cameraRadius*Math.sin(PHI)*Math.cos(THETA));
var at = vec3(0.0, 0.0, 0.0); // point camera towards origin
var up = vec3(0.0, 1.0, 0.0); // positive y-axis

// For the perspective function (projection matrix)
var fovy = 45.0;
var aspect = 1.0;
var near = 0.3;
var far = 1000;

// For face rotations
var rotationAxis = 0;
var rotationFace = 'none';
var rotationDir; // 1 indicates CW, -1 is CCW

// Used for rotation speed
// Temporary is used for switching speeds using the slider during a sequence of rotations
// Value of slider is stored in temp, then used for the actual speed only after a turn is done
var rotationSpeed = 15.0;
var rotationSpeedTemp = rotationSpeed;

// Indicator to check if a cubelet has rotated one turn (up to 90 degrees)
// Initialized at 90 so no rotations occur (rotation occurs only if <90)
var rotationAngle = 90;

// Queue for rotations, a rotation doesn't happen until the preceding rotations in the queue occur
var rotationQueue = [];

// Indicators for each axis for rotations
var xAxis = 0;
var yAxis = 1;
var zAxis = 2;

// Store angle positions for each cubelet
// Cubelet positions are their current positions, not their old ones
// Angle values get reset after a full turn
var thetaCubelet = new Array();
for (var ix = -1; ix <= 1; ix++) {
    var tempArrX = new Array();
    for (var iy = -1; iy <= 1; iy++) {
        var tempArrY = new Array();
        for (var iz = -1; iz <= 1; iz++) {
            tempArrY.push([0,0,0]);
        }
        tempArrX.push(tempArrY);
    }
    thetaCubelet.push(tempArrX);
}

// Keep track of positions for each cubelet
// Indices represent the original position (0,1,2 corresponds to -1,0,1)
// Elements are vec4s that represent the new coordinates (after rotations)
var cubeletPosition = new Array();
for (var ix = -1; ix <= 1; ix++) {
    var tempArrX = new Array();
    for (var iy = -1; iy <= 1; iy++) {
        var tempArrY = new Array();
        for (var iz = -1; iz <= 1; iz++) {
            tempArrY.push(vec4(ix,iy,iz,1));
        }
        tempArrX.push(tempArrY);
    }
    cubeletPosition.push(tempArrX);
}

// Keep track of cubelet transformation matrices, incremental turns
// Indices represent the original position (before rotations, since this is the matrix to get to the position post rotation)
// This is sent to the vertex shader
// Once a full turn has been made, values are rounded up and used to transform the positions matrix
var cubeletMatrix = new Array();
for (var ix = -1; ix <= 1; ix++) {
    var tempArrX = new Array();
    for (var iy = -1; iy <= 1; iy++) {
        var tempArrY = new Array();
        for (var iz = -1; iz <= 1; iz++) {
            tempArrY.push(mat4());
        }
        tempArrX.push(tempArrY);
    }
    cubeletMatrix.push(tempArrX);
}

// Keep track of each cubelet's orientation
// Used for checking if cube is solved (if orientations are all the same)
// Each orientation consists of 2 vectors indicating the normals of two orthogonal faces of the cube
// since 2 orthogonal faces determine the other faces
// Initial orientation is all the same, at (1,0,0), (0,1,0)
var cubeletOrientation = new Array();
for (var ix = -1; ix <= 1; ix++) {
    var tempArrX = new Array();
    for (var iy = -1; iy <= 1; iy++) {
        var tempArrY = new Array();
        for (var iz = -1; iz <= 1; iz++) {
            var tempArrZ = new Array();
            tempArrZ.push(vec4(1,0,0,0)); // last element is 0 since vector, not point
            tempArrZ.push(vec4(0,1,0,0));
            tempArrY.push(tempArrZ);
        }
        tempArrX.push(tempArrY);
    }
    cubeletOrientation.push(tempArrX);
}

// Globals for transformation matrices
var worldViewMatrix = mat4();
var projectionMatrix;
var modelViewMatrix;

// Locks the transformation matrices to pass to vertex shader
var worldViewMatrixLoc;
var projectionMatrixLoc;
var modelViewMatrixLoc;

// For randomize function, stores how many steps to randomize
var randomStepCount;

// For text file (save state) generation, needs to be global
// so previous file can be revoked otherwise there is a memory leak
var textFile = null;

// For loading in a file
var isFileLoaded = false; // checks if user has loaded a file
var fileContents; // contains the actual contents of the file to be loaded into cubeletPosition

// Helper function that indicates if cube is currently rotating
// If it is rotating, button presses don't do anything
function isRotating() {
    return (rotationAngle < 90);
}

// Init function
window.onload = function init()
{
    canvas = document.getElementById( "gl-canvas" );

    // Set up WebGL
    gl = WebGLUtils.setupWebGL( canvas );
    if ( !gl ) { alert( "WebGL isn't available" ); }

    gl.viewport( 0, 0, canvas.width, canvas.height );
    gl.clearColor( 1.0, 0.5, 0.6, 0.75 ); //gray
    //gl.clearColor( 1.0, 1.0, 1.0, 1.0 ); //white

    gl.enable(gl.DEPTH_TEST);

    // Generate Rubik's cube
    cubelet(vertexPos);
    genColors();

    // Load shaders and initialize attribute buffers
    program = initShaders( gl, "vertex-shader", "fragment-shader" );
    gl.useProgram( program );

    // Vertex array attribute buffer
    var vBuffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, vBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW );

    var vPosition = gl.getAttribLocation( program, "vPosition" );
    gl.vertexAttribPointer( vPosition, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( vPosition );

    // Set up uniforms
    worldViewMatrixLoc = gl.getUniformLocation(program, "worldViewMatrix");
    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");

    // Event listeners for mouse

    var startX, startY;

    canvas.addEventListener("mousedown", function(e) {
        heldDown = true;
        // Keep track of starting x and y positions
        startX = e.pageX;
        startY = e.pageY;
        //dTHETA = dPHI = 0;
        e.preventDefault();
        return false;
    });

    canvas.addEventListener("mouseup", function(e) {
        heldDown = false;
    });

    canvas.addEventListener("mousemove", function(e) {
        // If mouse isn't held down, nothing happens
        if (!heldDown) {
            return false;
        }
        // Otherwise, if mouse is held down, rotate the cube if dragged/
        // First find the distance between the old and new mouse positions
        // Then convert into radians by comparing it with the canvas dimensions
        // Negative d means counterclockwise
        dTHETA = (e.pageX-startX)*2*Math.PI/canvas.width;
        dPHI = (e.pageY-startY)*2*Math.PI/canvas.height;

        // Subtract PHI first, then check for discontinuity
        PHI = (PHI-dPHI)%(2*Math.PI);

        console.log("BEFORE",degrees(PHI))

        // Jump over discontinuity
        // Want to avoid the region (179,181) for discontinuity at 180
        // When approaching the discontinuity from above (dPHI > 0), jump to 179
        // and keep up vector positive (because 179 is before the flip)
        // Up vector is negated when approaching discontinuity from below since 181 is post-flip
        if (degrees(PHI) < 181 && degrees(PHI) > 179) {
            if (dPHI > 0) {
                PHI = radians(179);
            } else if (dPHI < 0) {
                PHI = radians(181);
            }
        }

        // Similar idea with discontinuity at 0
        // This time, negate up vector when approaching from above and vice versa
        if (degrees(PHI) < 1 && degrees(PHI) > -1) {
            if (dPHI > 0) {
                PHI = radians(-1);
            } else if (dPHI < 0) {
                PHI = radians(1);
            }
        }

        // Disconuity at -180
        if (degrees(PHI) < -179 && degrees(PHI) > -181) {
            if (dPHI > 0) {
                PHI = radians(-181);
            } else if (dPHI < 0) {
                PHI = radians(-179);
            }
        }

        // From degrees(PHI) E [-180, 0] U [180, 360], the up vector begins to point in
        // the opposite direction and the cube flips to preserve the up direction.
        // We don't want this to happen, so we flip the up vector when this happens
        // (also changes direction of rotation for THETA).
        if ((PHI > Math.PI && PHI < 2*Math.PI) || (PHI < 0 && PHI > -Math.PI)) {
            up = vec3(0.0, -1.0, 0.0);
            THETA = (THETA+dTHETA)%(2*Math.PI);
        } else {
            up = vec3(0.0, 1.0, 0.0);
            THETA = (THETA-dTHETA)%(2*Math.PI);
        }

        console.log("AFTER",degrees(PHI))

        // Save ending position as next starting position
        startX = e.pageX;
        startY = e.pageY;
        e.preventDefault();
    });

    canvas.addEventListener("mousewheel", function(e) {
        // Restrict to minimum and maximum zoom windows
        if (cameraRadius - e.wheelDelta/75 < cameraRadiusMin) {
            cameraRadius = cameraRadiusMin;
        } else if (cameraRadius - e.wheelDelta/75 > cameraRadiusMax) {
            cameraRadius = cameraRadiusMax;
        // If restrictions are not met, just zoom in or out
        } else {
            cameraRadius -= e.wheelDelta/75;
        }
    });

    // Event listeners for rotation buttons
    document.getElementById( "rightButton" ).onclick = function () {
        enqueueRotation('right', -1);
    };
    document.getElementById( "leftButton" ).onclick = function () {
        enqueueRotation('left', -1);
    };
    document.getElementById( "topButton" ).onclick = function () {
        enqueueRotation('top', -1);
    };
    document.getElementById( "bottomButton" ).onclick = function () {
        enqueueRotation('bottom', -1);
    };
    document.getElementById( "frontButton" ).onclick = function () {
        enqueueRotation('front', -1);
    };
    document.getElementById( "backButton" ).onclick = function () {
        enqueueRotation('back', -1);
    };
    document.getElementById( "rightButtonRev" ).onclick = function () {
        enqueueRotation('right', 1);
    };
    document.getElementById( "leftButtonRev" ).onclick = function () {
        enqueueRotation('left', 1);
    };
    document.getElementById( "topButtonRev" ).onclick = function () {
        enqueueRotation('top', 1);
    };
    document.getElementById( "bottomButtonRev" ).onclick = function () {
        enqueueRotation('bottom', 1);
    };
    document.getElementById( "frontButtonRev" ).onclick = function () {
        enqueueRotation('front', 1);
    };
    document.getElementById( "backButtonRev" ).onclick = function () {
        enqueueRotation('back', 1);
    };

    // Event listeners for keys (for rotation)
    document.onkeydown = function(e) {
        switch (e.keyCode) {
            case 39: // right arrow, rotates right face
                enqueueRotation('right', -1*(e.shiftKey ? -1 : 1));
                e.preventDefault();
                break;

            case 37: // left arrow, rotates left face
                enqueueRotation('left', -1*(e.shiftKey ? -1 : 1));
                e.preventDefault();
                break;

            case 38: // up arrow, rotates top face
                enqueueRotation('top',-1*(e.shiftKey ? -1 : 1));
                e.preventDefault();
                break;

            case 40: // down arrow, rotates bottom face
                enqueueRotation('bottom',-1*(e.shiftKey ? -1 : 1));
                e.preventDefault();
                break;

            case 90: // Z, rotates front face
                enqueueRotation('front',-1*(e.shiftKey ? -1 : 1));
                e.preventDefault();
                break;

            case 88: // X, rotates back face
                enqueueRotation('back',-1*(e.shiftKey ? -1 : 1));
                e.preventDefault();
                break;
        }
    }

    // Event listener for slider for rotation speed
    document.getElementById("speedSlider").onchange = function(e) {
        // Maps slider values to actual values
        rotationSpeedTemp = parseInt(e.target.value);
        switch(rotationSpeedTemp) {
            case 1:
                rotationSpeedTemp = 1;
                break;
            case 2:
                rotationSpeedTemp = 2;
                break;
            case 3:
                rotationSpeedTemp = 3;
                break;
            case 4:
                rotationSpeedTemp = 5;
                break;
            case 5:
                rotationSpeedTemp = 6;
                break;
            case 6:
                rotationSpeedTemp = 15;
                break;
            case 7:
                rotationSpeedTemp = 18;
                break;
            case 8:
                rotationSpeedTemp = 30;
                break;
            case 9:
                rotationSpeedTemp = 45;
                break;
            case 10:
                rotationSpeedTemp = 90;
                break;
        }
    };

    // Event listeners for buttons for other functionalities

    document.getElementById("resetButton").onclick = function(e) {
        if (!isRotating()) {
            resetState();
            //displaySolved(); // need to redo this upon loading
        }
        // Reset the state upon button press
        function resetState() {
            // Reset the cubelet positions to starting
            // Reset the cubelet matrices back to identity matrices
            for (var ix = -1; ix <= 1; ix++) {
                for (var iy = -1; iy <= 1; iy++) {
                    for (var iz = -1; iz <= 1; iz++) {
                        cubeletPosition[ix+1][iy+1][iz+1] = vec4(ix,iy,iz,1); // need this?
                        cubeletMatrix[ix+1][iy+1][iz+1] = mat4();
                        cubeletOrientation[ix+1][iy+1][iz+1][0] = vec4(1,0,0,0);
                        cubeletOrientation[ix+1][iy+1][iz+1][1] = vec4(0,1,0,0);
                    }
                }
            }
        }
    };

    document.getElementById("saveButton").onclick = function (e) {
        var link = document.getElementById("downloadLink");
        // For a less complicated save state, just use cubeletMatrix
        // since cubeletPosition and cubeletOrientation can both be computed from that
        // I'm lazy so I'll just store everything for now
        link.href = makeTextFile(JSON.stringify([cubeletPosition,cubeletMatrix,cubeletOrientation]));
        function makeTextFile(text) {
            var data = new Blob([text], {type: 'text/plain'});
            // If we are replacing a previously generated file we need to
            // manually revoke the object URL to avoid memory leaks.
            if (textFile !== null) {
              window.URL.revokeObjectURL(textFile);
            }
            textFile = window.URL.createObjectURL(data);
            return textFile;
        }
    };

    document.getElementById('fileUploadButton').addEventListener('change', function(e) {
        var file = e.target.files[0]; // FileList object, take only one file
        var reader = new FileReader(); // Crete file reader to interpret file
        // Change the file load event handler, i.e. what to do upon successful file loading
        reader.onload = function(e) {
            //console.log(e.target.result)
            fileContents = JSON.parse(reader.result); // parse JSON text and store into array
            var x, y, z, pos, mat, orient;
            for (x = 0; x < 3; x++) {
                for (y = 0; y < 3; y++) {
                    for (z = 0; z < 3; z++) {
                        pos = fileContents[0][x][y][z]; // element of cubeletPosition
                        mat = fileContents[1][x][y][z]; // element of cubeletMatrix
                        orient = fileContents[2][x][y][z];
                        // Remap each element into a vec4/mat4
                        fileContents[0][x][y][z] = vec4(pos[0], pos[1], pos[2], pos[3]);
                        fileContents[1][x][y][z] = mat4(mat[0][0], mat[0][1], mat[0][2], mat[0][3],
                                                        mat[1][0], mat[1][1], mat[1][2], mat[1][3],
                                                        mat[2][0], mat[2][1], mat[2][2], mat[2][3],
                                                        mat[3][0], mat[3][1], mat[3][2], mat[3][3]);
                        fileContents[2][x][y][z][0] = vec4(orient[0][0], orient[0][1], orient[0][2], orient[0][3]);
                        fileContents[2][x][y][z][1] = vec4(orient[1][0], orient[1][1], orient[1][2], orient[1][3]);
                        //console.log("HUH",fileContents[0][x][y][z], fileContents[1][x][y][z]. fileContents[2][x][y][z][0],fileContents[2][x][y][z][1])
                    }
                }
            }
            isFileLoaded = true;
        };
        // Finally read the file as a text string
        reader.readAsText(file);
    });

    // Make sure to reset the value so that whenever you click the choose file button
    // the file gets reset (and if you cancel, isFileLoaded will stay false)
    document.getElementById('fileUploadButton').onclick = function() {
        this.value = null;
        isFileLoaded = false;
    }

    document.getElementById("loadButton").onclick = function () {
        if (!isFileLoaded) {
            alert("Please select a cube state file.");
        } else {
            // Create a shallow copy of the file contents and store it in the cubeletMatrix array
            // Now the loaded state should appear
            cubeletPosition = fileContents[0].slice();
            cubeletMatrix = fileContents[1].slice();
            cubeletOrientation = fileContents[2].slice();
        }
    };

    document.getElementById("randomButton").onclick = function(e) {
        randomizeCube();
    }

    render();
}

// Function that generates a cubelet using quad
// Need to specify center of cube
function cubelet(v)
{
    quad( 2, 3, 7, 6, v); // right face
    quad( 5, 4, 0, 1, v); // left face
    quad( 6, 5, 1, 2, v); // top face
    quad( 3, 0, 4, 7, v); // bottom face
    quad( 1, 0, 3, 2, v); // front face
    quad( 4, 5, 6, 7, v); // back face
}

// Function that generates a quad (face) of one cubelet
// Need to specify the center of the cube (x, y, z)
function quad(a, b, c, d, v)
{
    // Vertices of one cubelet (8 to choose from)
    var vertices = [
        vec4( -v, -v,  v, 1.0 ),
        vec4( -v,  v,  v, 1.0 ),
        vec4(  v,  v,  v, 1.0 ),
        vec4(  v, -v,  v, 1.0 ),
        vec4( -v, -v, -v, 1.0 ),
        vec4( -v,  v, -v, 1.0 ),
        vec4(  v,  v, -v, 1.0 ),
        vec4(  v, -v, -v, 1.0 )
    ];

    // 6 vertices determine a face in a quad (2 triangles)
    var indices = [ a, b, c, a, c, d ];
    for ( var i = 0; i < indices.length; ++i ) {
        // Push the vertices into the vertex array
        points.push( vertices[indices[i]] );
    }
}

// Function that generates colors for the entire cube
function genColors()
{
    var x, y, z;
    for (x = -1; x <= 1; x++) {
        for (y = -1; y <= 1; y++) {
            for (z = -1; z <= 1; z++) {
                genColorsFace(2, 3, 7, 6, x, y, z); // right face
                genColorsFace(5, 4, 0, 1, x, y, z); // left face
                genColorsFace(6, 5, 1, 2, x, y, z); // top face
                genColorsFace(3, 0, 4, 7, x, y, z); // bottom face
                genColorsFace(1, 0, 3, 2, x, y, z); // front face
                genColorsFace(4, 5, 6, 7, x, y, z); // back face
            }
        }
    }

    // Generates the colors for a face
    // Also colors insides black
    function genColorsFace(a, b, c, d, x, y, z) {

        var vertexColors = [
            vec4( 0.0, 0.0, 0.0, 1.0 ), // black (inside), index 0
            vec4( 0.0, 1.0, 0.0, 1.0 ), // green (front), index 1
            vec4( 1.0, 0.0, 0.0, 1.0 ), // red (right), index 2
            vec4( 1.0, 1.0, 0.0, 1.0 ), // bottom (yellow), index 3
            vec4( 0.0, 0.0, 1.0, 1.0 ), // blue (back), index 4
            vec4( 1.0, 0.5, 0.0, 1.0 ), // orange (left), index 5
            vec4( 1.0, 1.0, 1.0, 1.0 ) // white (top), index 6
        ];

        // Booleans that indicate what side of the whole Rubick's cube this quad is on
        var rightRubix = (x == 1);
        var leftRubix = (x == -1);
        var topRubix = (y == 1);
        var bottomRubix = (y == -1);
        var frontRubix = (z == 1);
        var backRubix = (z == -1);

        // Booleans that indicate what face of the cublet this quad is on
        var rightCublet = (a == 2);
        var leftCublet = (a == 5);
        var topCublet = (a == 6);
        var bottomCublet = (a == 3);
        var frontCublet = (a == 1);
        var backCublet = (a == 4);

        // Booleans that indicate the face of this quad
        var right = rightRubix && rightCublet;
        var left = leftRubix && leftCublet;
        var top = topRubix && topCublet;
        var bottom = bottomRubix && bottomCublet;
        var front = frontRubix && frontCublet;
        var back = backRubix && backCublet;

        var indices = [ a, b, c, a, c, d ];
        for ( var i = 0; i < indices.length; ++i ) {
            //colors.push( vertexColors[a] ); // DEBUG, comment the rest of the loop out
            if (right || left || top || bottom || front || back) {
                colors.push( vertexColors[a] );
            } else {
                colors.push( vertexColors[0] );
            }  
        }
    }
}

// Push rotation onto rotation queue
function enqueueRotation(face, direction) {
    var axis;
    switch(face) {
        case 'right':
            axis = xAxis;
            break;
        case 'left':
            axis = xAxis;
            break;
        case 'top':
            axis = yAxis;
            break;
        case 'bottom':
            axis = yAxis;
            break;
        case 'front':
            axis = zAxis;
            break;
        case 'back':
            axis = zAxis;
            break;
    }
    rotationQueue.push([face,direction,axis]);
    //console.log("ENQUEUE", [face,direction,axis])

    // Want to try start a rotation as soon as you push one on
    dequeueRotation();
}

// Pop rotation from rotation queue
function dequeueRotation() {
    // If no rotations available or if a rotation is currently taking place, do nothing
    if (rotationQueue.length == 0 || isRotating()) {
        return;
    }
    // If a rotation is possible, pop off the rotation parameters
    var nextRotation = rotationQueue.shift();
    rotationFace = nextRotation[0];
    rotationDir = nextRotation[1];
    rotationAxis = nextRotation[2];
    //console.log("DEQUEUE", [rotationFace,rotationDir,rotationAxis])
    // This triggers the render function to start drawing the rotation
    rotationAngle = 0;
    rotationSpeed = rotationSpeedTemp;
}

function render()
{
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // World view matrix (involves translates and rotates for each cubelet)
    // Initialize to identity matrix
    worldViewMatrix = mat4();

    // Set the camera position at each render (spherical coordinates)
    eye = vec3(cameraRadius*Math.sin(PHI)*Math.sin(THETA),
            cameraRadius*Math.cos(PHI),
            cameraRadius*Math.sin(PHI)*Math.cos(THETA));

    // After releasing the mouse, want to produce a fading motion
    if (!heldDown) {

        dTHETA *= AMORTIZATION;
        dPHI *= AMORTIZATION
        
        PHI = (PHI-dPHI)%(2*Math.PI);

        console.log('BEFORE AMOR', degrees(PHI))

        if (degrees(PHI) < 181 && degrees(PHI) > 179) {
            if (dPHI > 0) {
                PHI = radians(179);
            } else if (dPHI < 0) {
                PHI = radians(181);
            }
        }
        if (degrees(PHI) < 1 && degrees(PHI) > -1) {
            if (dPHI > 0) {
                PHI = radians(-1);
            } else if (dPHI < 0) {
                PHI = radians(1);
            }
        }
        if (degrees(PHI) < -179 && degrees(PHI) > -181) {
            if (dPHI > 0) {
                PHI = radians(-181);
            } else if (dPHI < 0) {
                PHI = radians(-179);
            }
        }

        if ((PHI > Math.PI && PHI < 2*Math.PI) || (PHI < 0 && PHI > -Math.PI)) {
            up = vec3(0.0, -1.0, 0.0);
            THETA = (THETA+dTHETA)%(2*Math.PI);
        } else {
            up = vec3(0.0, 1.0, 0.0);
            THETA = (THETA-dTHETA)%(2*Math.PI);
        }

        console.log('AFTER AMOR', degrees(PHI))
    }
    
    // Model-view matrix
    modelViewMatrix = mat4();
    modelViewMatrix = mult(lookAt(eye, at, up), modelViewMatrix);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelViewMatrix));

    // Projection matrix
    projectionMatrix = perspective(fovy, aspect, near, far);
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

    var i = 0; // used to partition color array into cubes to generate the right colors
    var x, y, z; // starting positions
    var curX, curY, curZ, curPos; // current positions

    // Render each cube individually for rotations
    for (x = -1; x <= 1; x++) {
        for (y = -1; y <= 1; y++) {
            for (z = -1; z <= 1; z++) {

                // Translate cubelet to its proper place
                worldViewMatrix = mult(translate(x*spacing,y*spacing,z*spacing), worldViewMatrix);

                // Easier on eyes
                curPos = cubeletPosition[x+1][y+1][z+1];
                curX = curPos[0];
                curY = curPos[1];
                curZ = curPos[2];

                // Check if rotation is occurring
                // Want to only rotate for one turn, i.e. 90 degrees
                if (isRotating()) {

                    // Velocity includes speed and direction
                    var rotationVelocity = rotationDir*rotationSpeed;

                    var isRotatingCublet = false; // indicates that this cublet is being rotated, introduced to cut down repeated code

                    // We check the current positions, not the starting ones
                    if ((rotationFace == 'right' && curX == 1) || (rotationFace == 'left' && curX == -1)) {
                        // Incremental rotation, modify the cumulative matrix
                        cubeletMatrix[x+1][y+1][z+1] = mult(rotateX(rotationVelocity), cubeletMatrix[x+1][y+1][z+1]);
                        isRotatingCublet = true;
                    }

                    else if ((rotationFace == 'top' && curY == 1) || (rotationFace == 'bottom' && curY == -1)) {
                        cubeletMatrix[x+1][y+1][z+1] = mult(rotateY(rotationVelocity), cubeletMatrix[x+1][y+1][z+1]);
                        isRotatingCublet = true;
                    }

                    else if ((rotationFace == 'front' && curZ == 1) || (rotationFace == 'back' && curZ == -1)) {
                        cubeletMatrix[x+1][y+1][z+1] = mult(rotateZ(rotationVelocity), cubeletMatrix[x+1][y+1][z+1]);
                        isRotatingCublet = true;
                    }

                    if (isRotatingCublet) {

                        // Keep track of when angle reaches 90
                        thetaCubelet[curX+1][curY+1][curZ+1][rotationAxis] += rotationVelocity;

                        // If angle reached 90, a full turn is made, so record the new positions
                        if (Math.abs(thetaCubelet[curX+1][curY+1][curZ+1][rotationAxis]) >= 90.0) {
                            // Get the new cubelet position by multiplying the CUMULATIVE matrix to the ORIGINAL position
                            cubeletPosition[x+1][y+1][z+1] = mult(cubeletMatrix[x+1][y+1][z+1], vec4(x,y,z,1));
                            // Get the new cubelet orientation
                            cubeletOrientation[x+1][y+1][z+1][0] = mult(cubeletMatrix[x+1][y+1][z+1], vec4(1,0,0,0));
                            cubeletOrientation[x+1][y+1][z+1][1] = mult(cubeletMatrix[x+1][y+1][z+1], vec4(0,1,0,0));
                            // Round the elements in the positions matrix once a full turn has been reached
                            // Also round the elements in the rotation matrix, which is either 0, 1, or -1 (sin and cos of +-90)
                            // Added rounding orientations
                            for (var j = 0; j < 3; j++) {
                                cubeletPosition[x+1][y+1][z+1][j] = Math.round(cubeletPosition[x+1][y+1][z+1][j]);
                                for (var jj = 0; jj < 3; jj++) {
                                    cubeletMatrix[x+1][y+1][z+1][j][jj] = Math.round(cubeletMatrix[x+1][y+1][z+1][j][jj]);
                                }
                                cubeletOrientation[x+1][y+1][z+1][0][j] = Math.round(cubeletOrientation[x+1][y+1][z+1][0][j]);
                                cubeletOrientation[x+1][y+1][z+1][1][j] = Math.round(cubeletOrientation[x+1][y+1][z+1][1][j]);
                            }
                            thetaCubelet[curX+1][curY+1][curZ+1][rotationAxis] = 0;
                        }
                    }
                }

                // Now modify the world-view matrix to account for this additional cubelet rotation
                worldViewMatrix = mult(cubeletMatrix[x+1][y+1][z+1], worldViewMatrix);
                gl.uniformMatrix4fv(worldViewMatrixLoc, false, flatten(worldViewMatrix));

                // Color array attribute buffer
                var cBuffer = gl.createBuffer();
                gl.bindBuffer( gl.ARRAY_BUFFER, cBuffer );
                gl.bufferData( gl.ARRAY_BUFFER, flatten(colors.slice(i*NumVertices,(i+1)*NumVertices)), gl.STATIC_DRAW );

                var vColor = gl.getAttribLocation( program, "vColor" );
                gl.vertexAttribPointer(vColor, 4, gl.FLOAT, false, 0 , 0);
                gl.enableVertexAttribArray(vColor);

                // Draw out the vertices
                gl.drawArrays( gl.TRIANGLES, 0, NumVertices );

                worldViewMatrix = mat4();

                i += 1;
            }
        }
    }

    // Increment rotation angle after all the desired cubelets have been rotated
    // Want to only rotate for one turn, i.e. 90 degrees
    if (isRotating()) {
        rotationAngle += rotationSpeed;
        // Now check if full turn has been reached, if so then dequeue the next rotation
        // This will continue to dequeue until the queue is empty
        if (!isRotating()) {
            dequeueRotation();
            // Check if it's solved after every turn
            displaySolved();
        }
    } else {
        // If in stationary state, check if Rubik's cube is solved
        displaySolved();
    }

    requestAnimFrame( render );
}

// Randomize the cube for a certain amount of rotate steps, makes use of setInterval
// Customizable delay for different rotation speeds
// Could also use a queue in the render function
function randomizeCube() {

    // Get the total number of steps
    var steps = document.getElementById("randomStepCount").value;

    // Check is input is valid
    if(isNaN(steps) || steps == 0) {
        return;
    }

    // Randomize button; want to disable it when randomize is still occuring
    var btn = document.getElementById("randomButton");
    btn.disabled = true;
    
    for (var i = 0; i < steps; i++) {
        randomizedRotate();
    }

    // Enable button once randomize is done
    btn.disabled = false;

    // Rotate a random face of the cube in a random direction
    function randomizedRotate() {

        var faces = ['right','left','top','bottom','front','back'];
        var directions = [-1, 1];

        // Pick a random index from each of the above arrays
        var randFace = faces[Math.floor(Math.random()*faces.length)];
        var randDir = directions[Math.floor(Math.random()*directions.length)];
        enqueueRotation(randFace, randDir);
    }
}

// Checks if arrays are equal
function isArrayEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length != b.length) return false;

    for (var i = 0; i < a.length; ++i) {
        if (a[i] != b[i]) return false;
    }
    return true;
}

// Checks if orientations are equal
function isOrientationEqual(face1, face2) {
    return (isArrayEqual(face1[0],face2[0]) && isArrayEqual(face1[1],face2[1]));
}

// Checks if Rubix cube is solved
function isSolved() {
    var reference = cubeletOrientation[0][0][0];
    return (
            isOrientationEqual(cubeletOrientation[0][0][1], reference) &&
            isOrientationEqual(cubeletOrientation[0][0][2], reference) &&
            isOrientationEqual(cubeletOrientation[0][1][0], reference) &&
            isOrientationEqual(cubeletOrientation[0][1][1], reference) &&
            isOrientationEqual(cubeletOrientation[0][1][2], reference) &&
            isOrientationEqual(cubeletOrientation[0][2][0], reference) &&
            isOrientationEqual(cubeletOrientation[0][2][1], reference) &&
            isOrientationEqual(cubeletOrientation[0][2][2], reference) &&

            isOrientationEqual(cubeletOrientation[1][0][0], reference) &&
            isOrientationEqual(cubeletOrientation[1][0][1], reference) &&
            isOrientationEqual(cubeletOrientation[1][0][2], reference) &&
            isOrientationEqual(cubeletOrientation[1][1][0], reference) &&
            isOrientationEqual(cubeletOrientation[1][1][1], reference) &&
            isOrientationEqual(cubeletOrientation[1][1][2], reference) &&
            isOrientationEqual(cubeletOrientation[1][2][0], reference) &&
            isOrientationEqual(cubeletOrientation[1][2][1], reference) &&
            isOrientationEqual(cubeletOrientation[1][2][2], reference) &&

            isOrientationEqual(cubeletOrientation[2][0][0], reference) &&
            isOrientationEqual(cubeletOrientation[2][0][1], reference) &&
            isOrientationEqual(cubeletOrientation[2][0][2], reference) &&
            isOrientationEqual(cubeletOrientation[2][1][0], reference) &&
            isOrientationEqual(cubeletOrientation[2][1][1], reference) &&
            isOrientationEqual(cubeletOrientation[2][1][2], reference) &&
            isOrientationEqual(cubeletOrientation[2][2][0], reference) &&
            isOrientationEqual(cubeletOrientation[2][2][1], reference) &&
            isOrientationEqual(cubeletOrientation[2][2][2], reference)
            );
}

// Checks if Rubik's cube is solved and displays appropriate message
function displaySolved() {
    if (isSolved()) {
      document.getElementById("solvedMessage").innerHTML = "Solved: YES";
    } else {
      document.getElementById("solvedMessage").innerHTML = "Solved: NO";
    }
}