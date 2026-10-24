/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2017 Google Inc.
 * https://developers.google.com/blockly/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview The class representing an in-progress gesture, usually a drag
 * or a tap.
 * @author fenichel@google.com (Rachel Fenichel)
 */
'use strict';

goog.provide('Blockly.Gesture');

goog.require('Blockly.BlockAnimations');
goog.require('Blockly.BlockDragger');
goog.require('Blockly.BubbleDragger');
goog.require('Blockly.constants');
goog.require('Blockly.Events.Ui');
goog.require('Blockly.FlyoutDragger');
goog.require('Blockly.scratchBlocksUtils');
goog.require('Blockly.Tooltip');
goog.require('Blockly.Touch');
goog.require('Blockly.WorkspaceDragger');

goog.require('goog.asserts');
goog.require('goog.math.Coordinate');


/*
 * Note: In this file "start" refers to touchstart, mousedown, and pointerstart
 * events.  "End" refers to touchend, mouseup, and pointerend events.
 */
// TODO: Consider touchcancel/pointercancel.


/**
 * Class for one gesture.
 * @param {!Event} e The event that kicked off this gesture.
 * @param {!Blockly.WorkspaceSvg} creatorWorkspace The workspace that created
 *     this gesture and has a reference to it.
 * @constructor
 */
Blockly.Gesture = function(e, creatorWorkspace) {

  /**
   * The position of the mouse when the gesture started.  Units are css pixels,
   * with (0, 0) at the top left of the browser window (mouseEvent clientX/Y).
   * @type {goog.math.Coordinate}
   */
  this.mouseDownXY_ = null;

  /**
   * How far the mouse has moved during this drag, in pixel units.
   * (0, 0) is at this.mouseDownXY_.
   * @type {goog.math.Coordinate}
   * @private
   */
  this.currentDragDeltaXY_ = null;

  /**
   * The bubble that the gesture started on, or null if it did not start on a
   * bubble.
   * @type {Blockly.Bubble}
   * @private
   */
  this.startBubble_ = null;

  /**
   * The field that the gesture started on, or null if it did not start on a
   * field.
   * @type {Blockly.Field}
   * @private
   */
  this.startField_ = null;

  /**
   * The block that the gesture started on, or null if it did not start on a
   * block.
   * @type {Blockly.BlockSvg}
   * @private
   */
  this.startBlock_ = null;

  /**
   * The block that this gesture targets.  If the gesture started on a
   * shadow block, this is the first non-shadow parent of the block.  If the
   * gesture started in the flyout, this is the root block of the block group
   * that was clicked or dragged.
   * @type {Blockly.BlockSvg}
   * @private
   */
  this.targetBlock_ = null;

  /**
   * The workspace that the gesture started on.  There may be multiple
   * workspaces on a page; this is more accurate than using
   * Blockly.getMainWorkspace().
   * @type {Blockly.WorkspaceSvg}
   * @private
   */
  this.startWorkspace_ = null;

  /**
   * The workspace that created this gesture.  This workspace keeps a reference
   * to the gesture, which will need to be cleared at deletion.
   * This may be different from the start workspace.  For instance, a flyout is
   * a workspace, but its parent workspace manages gestures for it.
   * @type {Blockly.WorkspaceSvg}
   * @private
   */
  this.creatorWorkspace_ = creatorWorkspace;

  /**
   * Whether the pointer has at any point moved out of the drag radius.
   * A gesture that exceeds the drag radius is a drag even if it ends exactly at
   * its start point.
   * @type {boolean}
   * @private
   */
  this.hasExceededDragRadius_ = false;

  /**
   * Whether the workspace is currently being dragged.
   * @type {boolean}
   * @private
   */
  this.isDraggingWorkspace_ = false;

  /**
   * Whether the block is currently being dragged.
   * @type {boolean}
   * @private
   */
  this.isDraggingBlock_ = false;

  /**
   * Whether the bubble is currently being dragged.
   * @type {boolean}
   * @private
   */
  this.isDraggingBubble_ = false;

  /**
   * The event that most recently updated this gesture.
   * @type {!Event}
   * @private
   */
  this.mostRecentEvent_ = e;

  /**
   * A handle to use to unbind a mouse move listener at the end of a drag.
   * Opaque data returned from Blockly.bindEventWithChecks_.
   * @type {Array.<!Array>}
   * @private
   */
  this.onMoveWrapper_ = null;

  /**
   * A handle to use to unbind a mouse up listener at the end of a drag.
   * Opaque data returned from Blockly.bindEventWithChecks_.
   * @type {Array.<!Array>}
   * @private
   */
  this.onUpWrapper_ = null;

  /**
   * The object tracking a bubble drag, or null if none is in progress.
   * @type {Blockly.BubbleDragger}
   * @private
   */
  this.bubbleDragger_ = null;

  /**
   * The object tracking a block drag, or null if none is in progress.
   * @type {Blockly.BlockDragger}
   * @private
   */
  this.blockDragger_ = null;

  /**
   * The object tracking a workspace or flyout workspace drag, or null if none
   * is in progress.
   * @type {Blockly.WorkspaceDragger}
   * @private
   */
  this.workspaceDragger_ = null;

  /**
   * The flyout a gesture started in, if any.
   * @type {Blockly.Flyout}
   * @private
   */
  this.flyout_ = null;

  /**
   * Boolean for sanity-checking that some code is only called once.
   * @type {boolean}
   * @private
   */
  this.calledUpdateIsDragging_ = false;

  /**
   * Boolean for sanity-checking that some code is only called once.
   * @type {boolean}
   * @private
   */
  this.hasStarted_ = false;

  /**
   * Boolean used internally to break a cycle in disposal.
   * @type {boolean}
   * @private
   */
  this.isEnding_ = false;

  /**
   * True if dragging from the target block should duplicate the target block
   * and drag the duplicate instead.  This has a lot of side effects.
   * @type {boolean}
   * @private
   */
  this.shouldDuplicateOnDrag_ = false;

  /**
   * Whether Ctrl (or Cmd on Mac, where Ctrl+click is a right-click) was held
   * when the gesture started.  Captured once at mouse down so releasing the
   * key mid-drag does not change what the gesture is.
   * @type {boolean}
   * @private
   */
  this.ctrlHeld_ = false;

  /**
   * Whether the gesture is a Ctrl+drag box selection on the workspace.
   * @type {boolean}
   * @private
   */
  this.isBoxSelecting_ = false;

  /**
   * Whether the gesture is a Ctrl+drag of the current box selection.
   * @type {boolean}
   * @private
   */
  this.isBoxDragging_ = false;

  /**
   * The selection rectangle element, while a box selection is in progress.
   * @type {Element}
   * @private
   */
  this.boxSelectRect_ = null;

  /**
   * Box selection start position, in workspace units.
   * @type {goog.math.Coordinate}
   * @private
   */
  this.boxSelectStart_ = null;

  /**
   * Top-level blocks being moved by a box drag, and their positions at drag
   * start, in workspace units.
   * @type {!Array.<!Blockly.BlockSvg>}
   * @private
   */
  this.boxDragBlocks_ = null;

  /**
   * @type {!Array.<!goog.math.Coordinate>}
   * @private
   */
  this.boxDragOrigins_ = null;

  /**
   * Accumulated drag offset of a box drag, in workspace units.
   * @type {goog.math.Coordinate}
   * @private
   */
  this.boxDragTotal_ = null;
};

/**
 * Sever all links from this object.
 * @package
 */
Blockly.Gesture.prototype.dispose = function() {
  Blockly.Touch.clearTouchIdentifier();
  Blockly.Tooltip.unblock();
  // Clear the owner's reference to this gesture.
  this.creatorWorkspace_.clearGesture();

  if (this.onMoveWrapper_) {
    Blockly.unbindEvent_(this.onMoveWrapper_);
  }
  if (this.onUpWrapper_) {
    Blockly.unbindEvent_(this.onUpWrapper_);
  }


  this.startField_ = null;
  this.startBlock_ = null;
  this.targetBlock_ = null;
  this.startWorkspace_ = null;
  this.flyout_ = null;

  if (this.blockDragger_) {
    this.blockDragger_.dispose();
    this.blockDragger_ = null;
  }
  if (this.workspaceDragger_) {
    this.workspaceDragger_.dispose();
    this.workspaceDragger_ = null;
  }
  if (this.bubbleDragger_) {
    this.bubbleDragger_.dispose();
    this.bubbleDragger_ = null;
  }
  // A gesture can be disposed mid-box-select (e.g. an input steals focus);
  // never leave the rectangle behind in the DOM.
  if (this.boxSelectRect_) {
    goog.dom.removeNode(this.boxSelectRect_);
    this.boxSelectRect_ = null;
  }
  this.isBoxSelecting_ = false;
  this.isBoxDragging_ = false;
  this.boxDragBlocks_ = null;
  this.boxDragOrigins_ = null;
  this.boxDragTotal_ = null;
};

/**
 * Update internal state based on an event.
 * @param {!Event} e The most recent mouse or touch event.
 * @private
 */
Blockly.Gesture.prototype.updateFromEvent_ = function(e) {
  var currentXY = new goog.math.Coordinate(e.clientX, e.clientY);
  var changed = this.updateDragDelta_(currentXY);
  // Exceeded the drag radius for the first time.
  if (changed) {
    this.updateIsDragging_();
    Blockly.longStop_();
  }
  this.mostRecentEvent_ = e;
};

/**
 * DO MATH to set currentDragDeltaXY_ based on the most recent mouse position.
 * @param {!goog.math.Coordinate} currentXY The most recent mouse/pointer
 *     position, in pixel units, with (0, 0) at the window's top left corner.
 * @return {boolean} True if the drag just exceeded the drag radius for the
 *     first time.
 * @private
 */
Blockly.Gesture.prototype.updateDragDelta_ = function(currentXY) {
  this.currentDragDeltaXY_ = goog.math.Coordinate.difference(currentXY,
      this.mouseDownXY_);

  if (!this.hasExceededDragRadius_) {
    var currentDragDelta = goog.math.Coordinate.magnitude(
        this.currentDragDeltaXY_);

    // The flyout has a different drag radius from the rest of Blockly.
    var limitRadius = this.flyout_ ? Blockly.FLYOUT_DRAG_RADIUS :
        Blockly.DRAG_RADIUS;

    this.hasExceededDragRadius_ = currentDragDelta > limitRadius;
    return this.hasExceededDragRadius_;
  }
  return false;
};

/**
 * Update this gesture to record whether a block is being dragged from the
 * flyout.
 * This function should be called on a mouse/touch move event the first time the
 * drag radius is exceeded.  It should be called no more than once per gesture.
 * If a block should be dragged from the flyout this function creates the new
 * block on the main workspace and updates targetBlock_ and startWorkspace_.
 * @return {boolean} True if a block is being dragged from the flyout.
 * @private
 */
Blockly.Gesture.prototype.updateIsDraggingFromFlyout_ = function() {
  // Disabled blocks may not be dragged from the flyout.
  if (this.targetBlock_.disabled) {
    return false;
  }
  if (!this.flyout_.isScrollable() ||
      this.flyout_.isDragTowardWorkspace(this.currentDragDeltaXY_)) {
    this.startWorkspace_ = this.flyout_.targetWorkspace_;
    this.startWorkspace_.updateScreenCalculationsIfScrolled();
    // Pulling a fresh block out of the flyout starts a new interaction, so drop
    // any box selection that was sitting on the workspace (2026-10-17).
    if (this.startWorkspace_.clearBoxSelection) {
      this.startWorkspace_.clearBoxSelection();
    }
    // Start the event group now, so that the same event group is used for block
    // creation and block dragging.
    if (!Blockly.Events.getGroup()) {
      Blockly.Events.setGroup(true);
    }
    // The start block is no longer relevant, because this is a drag.
    this.startBlock_ = null;
    // Pass the pointer position down so the copy can be placed with the grabbed
    // spot (not just its upper left corner) under the cursor: the copy is drawn
    // at the workspace's scale, which need not match the flyout's, and anchoring
    // the corner alone leaves the block beside the pointer as soon as the two
    // differ. (2026-10-24)
    this.targetBlock_ = this.flyout_.createBlock(this.targetBlock_,
        this.mouseDownXY_);
    this.targetBlock_.select();
    return true;
  }
  return false;
};

/**
 * Update this gesture to record whether a bubble is being dragged.
 * This function should be called on a mouse/touch move event the first time the
 * drag radius is exceeded.  It should be called no more than once per gesture.
 * If a bubble should be dragged this function creates the necessary
 * BubbleDragger and starts the drag.
 * @return {boolean} true if a bubble is being dragged.
 * @private
 */
Blockly.Gesture.prototype.updateIsDraggingBubble_ = function() {
  if (!this.startBubble_) {
    return false;
  }

  this.isDraggingBubble_ = true;
  this.startDraggingBubble_();
  return true;
};

/**
 * Update this gesture to record whether a block is being dragged.
 * This function should be called on a mouse/touch move event the first time the
 * drag radius is exceeded.  It should be called no more than once per gesture.
 * If a block should be dragged, either from the flyout or in the workspace,
 * this function creates the necessary BlockDragger and starts the drag.
 * @return {boolean} true if a block is being dragged.
 * @private
 */
Blockly.Gesture.prototype.updateIsDraggingBlock_ = function() {
  if (!this.targetBlock_) {
    return false;
  }

  if (this.flyout_) {
    this.isDraggingBlock_ = this.updateIsDraggingFromFlyout_();
  } else if (this.targetBlock_.isMovable() || this.shouldDuplicateOnDrag_){
    this.isDraggingBlock_ = true;
  }

  if (this.isDraggingBlock_) {
    this.startDraggingBlock_();
    return true;
  }
  return false;
};

/**
 * Update this gesture to record whether a workspace is being dragged.
 * This function should be called on a mouse/touch move event the first time the
 * drag radius is exceeded.  It should be called no more than once per gesture.
 * If a workspace is being dragged this function creates the necessary
 * WorkspaceDragger or FlyoutDragger and starts the drag.
 * @private
 */
Blockly.Gesture.prototype.updateIsDraggingWorkspace_ = function() {
  var wsMovable = this.flyout_ ? this.flyout_.isScrollable() :
      this.startWorkspace_ && this.startWorkspace_.isDraggable();

  if (!wsMovable) {
    return;
  }

  if (this.flyout_) {
    this.workspaceDragger_ = new Blockly.FlyoutDragger(this.flyout_);
  } else {
    this.workspaceDragger_ = new Blockly.WorkspaceDragger(this.startWorkspace_);
  }

  this.isDraggingWorkspace_ = true;
  this.workspaceDragger_.startDrag();
};

/**
 * Update this gesture to record whether anything is being dragged.
 * This function should be called on a mouse/touch move event the first time the
 * drag radius is exceeded.  It should be called no more than once per gesture.
 * @private
 */
Blockly.Gesture.prototype.updateIsDragging_ = function() {
  // Sanity check.
  goog.asserts.assert(!this.calledUpdateIsDragging_,
      'updateIsDragging_ should only be called once per gesture.');
  this.calledUpdateIsDragging_ = true;

  // First check if it was a bubble drag.  Bubbles always sit on top of blocks.
  if (this.updateIsDraggingBubble_()) {
    return;
  }
  // Then check for a Ctrl+drag box selection, or a Ctrl+drag of the current
  // box selection.  Both take priority over block and workspace drags.
  if (this.updateBoxGesture_()) {
    return;
  }
  // Then check if it was a block drag.
  if (this.updateIsDraggingBlock_()) {
    return;
  }
  // Then check if it's a workspace drag.
  this.updateIsDraggingWorkspace_();
};

/**
 * Create a block dragger and start dragging the selected block.
 * @private
 */
Blockly.Gesture.prototype.startDraggingBlock_ = function() {
  if (this.shouldDuplicateOnDrag_) {
    this.duplicateOnDrag_();
  }
  this.blockDragger_ = new Blockly.BlockDragger(this.targetBlock_,
      this.startWorkspace_);
  this.blockDragger_.startBlockDrag(this.currentDragDeltaXY_);
  this.blockDragger_.dragBlock(this.mostRecentEvent_,
      this.currentDragDeltaXY_);
};

/**
 * Create a bubble dragger and start dragging the selected bubble.
 * TODO (fenichel): Possibly combine this and startDraggingBlock_.
 * @private
 */
Blockly.Gesture.prototype.startDraggingBubble_ = function() {
  this.bubbleDragger_ = new Blockly.BubbleDragger(this.startBubble_,
      this.startWorkspace_);
  this.bubbleDragger_.startBubbleDrag();
  this.bubbleDragger_.dragBubble(this.mostRecentEvent_,
      this.currentDragDeltaXY_);
};

/* Begin box selection (Ctrl+drag) gesture handling.  See
 * Blockly.WorkspaceSvg.prototype.getBoxSelection for the selection state. */

/**
 * Update this gesture to record whether it is a Ctrl+drag box selection or a
 * Ctrl+drag of the current box selection.  This function should be called on a
 * mouse/touch move event the first time the drag radius is exceeded.  It
 * should be called no more than once per gesture.
 * @return {boolean} true if a box gesture was started.
 * @private
 */
Blockly.Gesture.prototype.updateBoxGesture_ = function() {
  if (!this.ctrlHeld_ || this.flyout_ || !this.startWorkspace_ ||
      !this.startWorkspace_.options.hasBoxSelect) {
    return false;
  }
  if (this.targetBlock_) {
    // Ctrl+drag starting on an already-selected block moves the selection.
    // Ctrl+drag on an unselected block falls through to a normal block drag.
    if (this.startWorkspace_.isBlockBoxSelected(this.targetBlock_)) {
      return this.startBoxDrag_();
    }
    return false;
  }
  // Ctrl+drag on empty workspace draws the selection rectangle.
  return this.startBoxSelect_();
};

/**
 * Convert a mouse event's client coordinates into workspace units on the
 * gesture's start workspace.  The block canvas carries the workspace
 * translate+scale transform, so the inverse of its CTM maps screen pixels
 * straight to workspace units.
 * @param {!Event} e A mouse or touch event with clientX/clientY.
 * @return {!goog.math.Coordinate} Position in workspace coordinates.
 * @private
 */
Blockly.Gesture.prototype.eventToWorkspaceUnits_ = function(e) {
  var ws = this.startWorkspace_;
  // Step 1: client coords -> parent-svg viewport coords (mouseToSvg falls back
  // to the svg's inverse screen CTM, which includes the svg's document
  // offset). Step 2: viewport -> canvas user space = workspace units. Same
  // two-step the zoom path uses (workspace_svg.js onMouseWheel_ + zoom).
  var svgXY = Blockly.utils.mouseToSvg(e, ws.getParentSvg());
  return svgXY.matrixTransform(ws.getCanvas().getCTM().inverse());
};

/**
 * Start a box selection: create the selection rectangle inside the block
 * canvas, so it inherits the canvas transform (workspace coordinates).
 * @return {boolean} True, always.
 * @private
 */
Blockly.Gesture.prototype.startBoxSelect_ = function() {
  this.isBoxSelecting_ = true;
  this.boxSelectStart_ = this.eventToWorkspaceUnits_(this.mostRecentEvent_);
  this.boxSelectRect_ = Blockly.utils.createSvgElement('rect',
      {
        'class': 'blocklyBoxSelectRect',
        'x': this.boxSelectStart_.x,
        'y': this.boxSelectStart_.y,
        'width': 0,
        'height': 0,
        // Keep the outline one pixel wide at any zoom level.
        'vector-effect': 'non-scaling-stroke'
      },
      this.startWorkspace_.getCanvas());
  return true;
};

/**
 * Update the selection rectangle and re-run the hit test for the current drag
 * position.  Rectangles come from cached block state, so this is
 * O(top blocks + blocks inside touched stacks) per move with no forced
 * layout.  The hit test is per block, not per stack: a rectangle covering
 * part of a stack selects only the blocks it actually touches.  The precise
 * test uses each block's SVG outline (see
 * Blockly.BlockSvg.intersectsWorkspaceRect), so space beside a C shape or a
 * hat's overhang is not a hit even though the bounding box overlaps.
 * @param {!Event} e The most recent mouse or touch event.
 * @private
 */
Blockly.Gesture.prototype.updateBoxSelect_ = function(e) {
  var ws = this.startWorkspace_;
  var start = this.boxSelectStart_;
  var current = this.eventToWorkspaceUnits_(e);
  var x = Math.min(start.x, current.x);
  var y = Math.min(start.y, current.y);
  var width = Math.abs(current.x - start.x);
  var height = Math.abs(current.y - start.y);
  var rect = this.boxSelectRect_;
  if (rect) {
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
  }
  var hits = [];
  var topBlocks = ws.getTopBlocks(false);
  for (var i = 0; i < topBlocks.length; i++) {
    var root = topBlocks[i];
    if (!root.getSvgRoot()) {
      continue;
    }
    // Coarse test on the stack bounding box first, then a per-block test on
    // each block's own rectangle (width/height are cached render metrics).
    var bounds = root.getBoundingRectangle();
    if (!(x < bounds.bottomRight.x && bounds.topLeft.x < x + width &&
        y < bounds.bottomRight.y && bounds.topLeft.y < y + height)) {
      continue;
    }
    var stack = root.getDescendants(false);
    for (var j = 0; j < stack.length; j++) {
      var block = stack[j];
      if (!block.getSvgRoot() || !block.isBoxSelectable()) {
        continue;
      }
      var xy = block.getRelativeToSurfaceXY();
      if (x < xy.x + block.width && xy.x < x + width &&
          y < xy.y + block.height && xy.y < y + height &&
          block.intersectsWorkspaceRect(x, y, width, height)) {
        hits.push(block);
      }
    }
  }
  // A container whose marquee overlap lies entirely inside its children's
  // areas yields to those children (see filterContainerHits_): marqueeing a
  // C block's body — or a reporter inside a socket — selects those blocks
  // alone instead of pulling the whole container into the selection
  // (2026-10-18).
  var kept = this.filterContainerHits_(hits, x, y, width, height);
  ws.setBoxSelection(kept);
};

/**
 * Remove from the box-selection hit list every container block that the
 * marquee only touches through the areas occupied by its nested children
 * (a C shape's cavity, a value socket).  The inside of a C shape is part of
 * the container's collision shape, so a rectangle over a C block's body —
 * or over a reporter in a socket — would always hit the container too and
 * drag its whole contents into the selection.  See
 * containerTouchedOnlyThroughChildren_ for when the container yields.
 * @param {!Array.<!Blockly.BlockSvg>} hits The blocks hit by the marquee.
 * @param {number} rx Marquee left edge, workspace units.
 * @param {number} ry Marquee top edge, workspace units.
 * @param {number} rw Marquee width, workspace units.
 * @param {number} rh Marquee height, workspace units.
 * @return {!Array.<!Blockly.BlockSvg>} The filtered hit list.
 * @private
 */
Blockly.Gesture.prototype.filterContainerHits_ = function(hits, rx, ry, rw,
    rh) {
  if (!hits.length) {
    return hits;
  }
  var hitSet = new Set(hits);
  var kept = [];
  for (var i = 0; i < hits.length; i++) {
    if (!this.containerTouchedOnlyThroughChildren_(hits[i], hitSet, rx, ry,
        rw, rh)) {
      kept.push(hits[i]);
    }
  }
  return kept;
};

/**
 * Whether a hit block is overlapped by the marquee exclusively through the
 * areas occupied by its nested children, so it must yield to them.  The
 * container yields when both hold:
 *  1. at least one real (non-shadow) nested child of it is itself hit, and
 *  2. every sampled point of the marquee that lies inside the container's
 *     collision shape also lies inside one of the child zones — the marquee
 *     never reached the container's own shell (header, walls, bottom bar).
 * A statement child's zone is the container's full-width band from that
 * child's top down to the container's bottom (a body block is flush with
 * the cavity's left wall, and the cavity's empty space to its right and
 * below belongs to the child side); a value child's zone is its socket
 * outline (which fills the socket hole even around a smaller reporter).
 * Boxing only a container's header still selects the whole container, and
 * boxing a shadow field alone keeps the container too — a shadow is not a
 * real child (2026-10-18).
 * @param {!Blockly.BlockSvg} block The hit container block.
 * @param {!Set.<!Blockly.BlockSvg>} hitSet All blocks hit by the marquee.
 * @param {number} rx Marquee left edge, workspace units.
 * @param {number} ry Marquee top edge, workspace units.
 * @param {number} rw Marquee width, workspace units.
 * @param {number} rh Marquee height, workspace units.
 * @return {boolean} True if the container must yield to its children.
 * @private
 */
Blockly.Gesture.prototype.containerTouchedOnlyThroughChildren_ = function(
    block, hitSet, rx, ry, rw, rh) {
  var blockXY = block.getRelativeToSurfaceXY();
  var blockRight = blockXY.x + block.width;
  var blockBottom = blockXY.y + block.height;
  // Pass 1: collect the child zones and look for a hit real child.
  var zones = [];
  var hasRealHitChild = false;
  var walk = function(b, statementSide) {
    for (var i = 0, input; input = b.inputList[i]; i++) {
      if (!input.connection) {
        continue;
      }
      var child = input.connection.targetBlock();
      if (!child) {
        continue;
      }
      if (input.type === Blockly.NEXT_STATEMENT) {
        var cxy = child.getRelativeToSurfaceXY();
        zones.push({left: blockXY.x, right: blockRight,
            top: cxy.y, bottom: blockBottom});
        if (!child.isShadow() && hitSet.has(child)) {
          hasRealHitChild = true;
        }
        walk(child, true);
      } else {
        // Value socket: use the socket outline when it exists (it fills the
        // socket hole even around a smaller reporter), else the child box.
        // The zone extends ~10px past the socket: a box-select drag can only
        // start on empty canvas, so the rectangle over a socket reporter
        // inevitably grazes the row around it — the graze must not count as
        // touching the container's shell (2026-10-18).
        var zone = null;
        if (input.outlinePath) {
          try {
            var bbox = input.outlinePath.getBBox();
            zone = {left: bbox.x + blockXY.x - 10,
                right: bbox.x + bbox.width + blockXY.x + 10,
                top: bbox.y + blockXY.y - 10,
                bottom: bbox.y + bbox.height + blockXY.y + 10};
          } catch (e) {
            zone = null;  // outline not measurable yet: fall back to child box
          }
        }
        if (!zone) {
          var vxy = child.getRelativeToSurfaceXY();
          zone = {left: vxy.x - 10, right: vxy.x + child.width + 10,
              top: vxy.y - 10, bottom: vxy.y + child.height + 10};
        }
        zones.push(zone);
        if (!child.isShadow() && hitSet.has(child)) {
          hasRealHitChild = true;
        }
        walk(child, false);
      }
    }
    if (b === block) {
      return;  // the container's own next chain lies outside it
    }
    var next = b.nextConnection && b.nextConnection.targetBlock();
    if (next && statementSide) {
      var nxy = next.getRelativeToSurfaceXY();
      zones.push({left: blockXY.x, right: blockRight,
          top: nxy.y, bottom: blockBottom});
      if (!next.isShadow() && hitSet.has(next)) {
        hasRealHitChild = true;
      }
      walk(next, true);
    }
  };
  walk(block, false);
  if (!zones.length || !hasRealHitChild) {
    return false;
  }
  // Pass 2: sample the marquee's overlap with the container's bounding box;
  // any sample on the container's own shape outside every child zone means
  // the marquee genuinely touched the container.
  var bounds = block.getBoundingRectangle();
  var left = Math.max(rx, bounds.topLeft.x);
  var right = Math.min(rx + rw, bounds.bottomRight.x);
  var top = Math.max(ry, bounds.topLeft.y);
  var bottom = Math.min(ry + rh, bounds.bottomRight.y);
  if (left >= right || top >= bottom) {
    return false;
  }
  var polygons = block.getCollisionPolygons_();
  if (!polygons.length) {
    return false;
  }
  var nx = Math.min(24, Math.max(1, Math.ceil((right - left) / 6)));
  var ny = Math.min(24, Math.max(1, Math.ceil((bottom - top) / 6)));
  for (var ix = 0; ix <= nx; ix++) {
    var px = left + (right - left) * ix / nx;
    for (var iy = 0; iy <= ny; iy++) {
      var py = top + (bottom - top) * iy / ny;
      var onShape = false;
      for (var p = 0; p < polygons.length; p++) {
        if (Blockly.BlockSvg.pointInPolygon_(px, py, polygons[p],
            blockXY.x, blockXY.y)) {
          onShape = true;
          break;
        }
      }
      if (!onShape) {
        continue;
      }
      var inZone = false;
      for (var z = 0; z < zones.length; z++) {
        if (px >= zones[z].left && px <= zones[z].right &&
            py >= zones[z].top && py <= zones[z].bottom) {
          inZone = true;
          break;
        }
      }
      if (!inZone) {
        return false;  // the marquee reached the container's own shell
      }
    }
  }
  return true;
};

/**
 * End a box selection: drop the rectangle and keep the highlighted blocks.
 * @private
 */
Blockly.Gesture.prototype.endBoxSelect_ = function() {
  if (this.boxSelectRect_) {
    goog.dom.removeNode(this.boxSelectRect_);
    this.boxSelectRect_ = null;
  }
  this.isBoxSelecting_ = false;
};

/**
 * Start dragging the current box selection: every selected block moves by the
 * same delta.  Unlike a single block drag this moves the blocks in place: no
 * block drag surface, no connection snapping, no bumping.  The selection
 * moves rigidly, which is what a group drag means here.
 *
 * The drag unit is exactly the box selection: a block only takes its
 * input-/statement-nested children (everything inside it).  Its trailing
 * statement chain (the blocks below it on the stack) is taken ONLY when those
 * blocks were themselves selected; otherwise the unselected block below is
 * detached and stays put, so dragging one block out of the middle of a stack
 * tears it out instead of stretching the connections.  The unit is computed by
 * scratchBlocksUtils.collectUnit_, which follows input/statement nesting (and
 * the next chains inside statement bodies) but stops at the block's own next
 * connection (2026-10-17).
 * @return {boolean} True if the drag started, false if nothing is draggable.
 * @private
 */
Blockly.Gesture.prototype.startBoxDrag_ = function() {
  var ws = this.startWorkspace_;
  var moveSet = new Set();
  ws.getBoxSelection().forEach(function(block) {
    if (block.workspace !== ws || !block.isMovable() || !block.getSvgRoot()) {
      return;
    }
    // A selected block drags as a unit with everything nested inside it (input
    // values and statement bodies, including the next chains within those
    // bodies), but NOT the blocks below it on its own next connection — those
    // only come along if they were selected too (2026-10-17: previously a
    // getDescendants + getNextBlock loop pulled the whole stack below a single
    // selected block along for the ride).
    Blockly.scratchBlocksUtils.collectUnit_(block, moveSet, false);
  });
  if (!moveSet.size) {
    return false;
  }
  // Detach anything whose parent stays behind, mirroring BlockDragger's unplug
  // for a single dragged block.  Also detach a trailing next block that was NOT
  // selected, so dragging one block out of the middle of a stack tears it out
  // instead of stretching the connections.  The next block is left attached when
  // it is itself part of the unit (e.g. a statement body continuation), so the
  // inside of a C-block still moves as one piece.
  if (!Blockly.Events.getGroup()) {
    Blockly.Events.setGroup(true);
  }
  moveSet.forEach(function(block) {
    var parent = block.getParent();
    if (parent && !moveSet.has(parent)) {
      block.unplug();
    }
    if (block.nextConnection && block.nextConnection.targetConnection &&
        !moveSet.has(block.nextConnection.targetBlock())) {
      block.nextConnection.disconnect();
    }
  });
  this.boxDragBlocks_ = [];
  var self = this;
  moveSet.forEach(function(block) {
    self.boxDragBlocks_.push(block);
  });
  this.boxDragOrigins_ = this.boxDragBlocks_.map(function(block) {
    return block.getRelativeToSurfaceXY();
  });
  this.boxDragTotal_ = new goog.math.Coordinate(0, 0);
  this.isBoxDragging_ = true;
  // Suppress per-move workspace resizes, same as BlockDragger.startBlockDrag.
  ws.setResizesEnabled(false);
  return true;
};

/**
 * Move the box-selected stacks by the current drag delta.
 * @param {!goog.math.Coordinate} currentDragDeltaXY Total drag delta in pixel
 *     units, relative to the gesture start.
 * @private
 */
Blockly.Gesture.prototype.updateBoxDrag_ = function(currentDragDeltaXY) {
  var ws = this.startWorkspace_;
  // Pixel delta -> workspace units (the canvas transform scales by ws.scale).
  var total = new goog.math.Coordinate(
      currentDragDeltaXY.x / ws.scale, currentDragDeltaXY.y / ws.scale);
  var delta = goog.math.Coordinate.difference(total, this.boxDragTotal_);
  this.boxDragTotal_ = total;
  for (var i = 0; i < this.boxDragBlocks_.length; i++) {
    var block = this.boxDragBlocks_[i];
    // In this fork every block's svgGroup is nested inside its parent's group, so
    // a nested child is positioned RELATIVE to its parent, not in absolute
    // surface coordinates. Translating a child by its absolute surface origin
    // therefore double-applies the parent transform and throws it off (blocks
    // "jump" / 错位). Only top-level (parentless) blocks get their transform set;
    // nested children ride along with the parent group, and moveConnections_
    // below recurses into them to keep their connection DB in sync. This mirrors
    // BlockDragger, which only translates root blocks (2026-10-17).
    if (block.getParent()) {
      continue;
    }
    var origin = this.boxDragOrigins_[i];
    // translate() takes an absolute position and fires no events;
    // moveConnections_ keeps the connection database in sync with the delta.
    block.translate(origin.x + total.x, origin.y + total.y);
    block.moveConnections_(delta.x, delta.y);
    // The stack moved: drop its cached rects so viewport culling stays correct.
    ws.invalidateContentBounds_(block.getRootBlock());
  }
  // Keep culling fresh while the selection moves, same as BlockDragger
  // (PATCH 8 in BlockDragger.dragBlock).
  ws.queueIntersectionCheck();
};

/**
 * End a box drag: fire one move event per moved top-level block so the VM and
 * the undo stack see the new positions, then re-enable workspace resizes.
 * @private
 */
Blockly.Gesture.prototype.endBoxDrag_ = function() {
  var ws = this.startWorkspace_;
  if (Blockly.Events.isEnabled()) {
    for (var i = 0; i < this.boxDragBlocks_.length; i++) {
      var block = this.boxDragBlocks_[i];
      // Only top-level blocks carry a meaningful workspace position; nested
      // blocks moved with their parent (same as a single block drag's
      // fireMoveEvent_, which reports the dragged root only).
      if (block.getParent()) {
        continue;
      }
      var event = new Blockly.Events.BlockMove(block);
      event.oldCoordinate = this.boxDragOrigins_[i];
      event.recordNew();
      Blockly.Events.fire(event);
    }
  }
  for (var j = 0; j < this.boxDragBlocks_.length; j++) {
    if (!this.boxDragBlocks_[j].getParent()) {
      ws.resizeContents(this.boxDragBlocks_[j].getRootBlock());
    }
  }
  this.boxDragBlocks_ = null;
  this.boxDragOrigins_ = null;
  this.boxDragTotal_ = null;
  this.isBoxDragging_ = false;
  ws.setResizesEnabled(true);
  if (Blockly.Events.getGroup()) {
    Blockly.Events.setGroup(false);
  }
  ws.queueIntersectionCheck();
};

/**
 * Toggle a single block in the box selection (Ctrl+click). Selection is per
 * block, not per stack: clicking one block of a stack toggles just that
 * block. Its nested contents (reporters, shadows, statement stacks) come
 * along, exactly as in the rubber-band path. Dragging the selection later
 * still moves following statements and nested blocks along (see
 * startBoxDrag_).
 * @param {!Blockly.BlockSvg} block The block to toggle.
 * @private
 */
Blockly.Gesture.prototype.toggleBoxSelection_ = function(block) {
  var ws = this.startWorkspace_;
  var selection = ws.getBoxSelection();
  var exp = ws.expandBoxSelectionNested_([block]);
  var blocks = exp.blocks;
  if (selection.has(block)) {
    selection.delete(block);
    for (var i = 0; i < blocks.length; i++) {
      selection.delete(blocks[i]);
      blocks[i].setBoxSelectStyle(false);
    }
    if (Blockly.selected === block) {
      block.unselect();
    }
  } else {
    selection.add(block);
    // Colour each selected block from its OWN colour source (sourceOf), exactly
    // like setBoxSelection: a nested reporter / shadow inherits the colour of the
    // block that holds it, while a C block's contents keep their own colours (see
    // expandBoxSelectionNested_ and the 2026-10-17 report). A single-click toggle
    // must NOT paint every nested block in the toggled block's colour — that is
    // what made a reporter nested in `move N steps` come out blue instead of its
    // own green.
    var sourceColors = new Map();
    exp.sourceOf.forEach(function(source, blk) {
      if (sourceColors.has(source)) {
        return;
      }
      sourceColors.set(source, ws.getBoxSelectColors_(source));
    });
    for (var j = 0; j < blocks.length; j++) {
      selection.add(blocks[j]);
      var src = exp.sourceOf.get(blocks[j]);
      if (src && src !== blocks[j]) {
        // A nested value/statement child inherits only its CONTAINER'S BORDER
        // colour; it keeps its OWN fill untouched (2026-10-18). Pass null for the
        // fill so BlockSvg.setBoxSelectStyle paints the outline alone.
        var colours = sourceColors.get(src);
        blocks[j].setBoxSelectStyle(true, colours ? colours.stroke : undefined, null);
      } else {
        // Directly-toggled block: darkened own fill + brighter own-colour border.
        blocks[j].setBoxSelectStyle(true);
      }
    }
  }
};

/* End box selection gesture handling. */
/**
 * Start a gesture: update the workspace to indicate that a gesture is in
 * progress and bind mousemove and mouseup handlers.
 * @param {!Event} e A mouse down or touch start event.
 * @package
 */
Blockly.Gesture.prototype.doStart = function(e) {
  if (Blockly.utils.isTargetInput(e)) {
    this.cancel();
    return;
  }
  this.hasStarted_ = true;

  Blockly.BlockAnimations.disconnectUiStop();
  this.startWorkspace_.updateScreenCalculationsIfScrolled();
  if (this.startWorkspace_.isMutator) {
    // Mutator's coordinate system could be out of date because the bubble was
    // dragged, the block was moved, the parent workspace zoomed, etc.
    this.startWorkspace_.resize();
  }
  this.startWorkspace_.markFocused();
  this.mostRecentEvent_ = e;

  // Hide chaff also hides the flyout, so don't do it if the click is in a flyout.
  Blockly.hideChaff(!!this.flyout_);
  Blockly.Tooltip.block();

  if (this.targetBlock_) {
    this.targetBlock_.select();
  }

  if (Blockly.utils.isRightButton(e)) {
    this.handleRightClick(e);
    return;
  }

  if (goog.string.caseInsensitiveEquals(e.type, 'touchstart')) {
    Blockly.longStart_(e, this);
  }

  this.mouseDownXY_ = new goog.math.Coordinate(e.clientX, e.clientY);
  this.currentDragDeltaXY_ = new goog.math.Coordinate(0, 0);
  // Ctrl (or Cmd on Mac) decides between a box gesture and the normal
  // block/workspace gestures; capture it once, at mouse down.
  this.ctrlHeld_ = !!(e.ctrlKey || e.metaKey);
  // A plain mousedown on a block starts a fresh single-block interaction, so
  // any existing box selection is dropped.  Ctrl+drag starting on a selected
  // block keeps the selection and drags it instead (see updateBoxGesture_).
  if (this.targetBlock_ && !this.ctrlHeld_ && this.startWorkspace_ &&
      this.startWorkspace_.clearBoxSelection) {
    this.startWorkspace_.clearBoxSelection();
  }

  this.bindMouseEvents(e);
};

/**
 * Bind gesture events.
 * @param {!Event} e A mouse down or touch start event.
 * @package
 */
Blockly.Gesture.prototype.bindMouseEvents = function(e) {
  this.onMoveWrapper_ = Blockly.bindEventWithChecks_(
      document, 'mousemove', null, this.handleMove.bind(this));
  this.onUpWrapper_ = Blockly.bindEventWithChecks_(
      document, 'mouseup', null, this.handleUp.bind(this));

  e.preventDefault();
  e.stopPropagation();
};

/**
 * Handle a mouse move or touch move event.
 * @param {!Event} e A mouse move or touch move event.
 * @package
 */
Blockly.Gesture.prototype.handleMove = function(e) {
  var stopPropagation = true;
  this.updateFromEvent_(e);
  if (this.isDraggingWorkspace_) {
    this.workspaceDragger_.drag(this.currentDragDeltaXY_);
  } else if (this.isDraggingBlock_) {
    if (this.blockDragger_.dragBlock(
        this.mostRecentEvent_, this.currentDragDeltaXY_)) {
      stopPropagation = false;
    }
  } else if (this.isBoxSelecting_) {
    this.updateBoxSelect_(this.mostRecentEvent_);
  } else if (this.isBoxDragging_) {
    this.updateBoxDrag_(this.currentDragDeltaXY_);
  } else if (this.isDraggingBubble_) {
    this.bubbleDragger_.dragBubble(this.mostRecentEvent_,
        this.currentDragDeltaXY_);
  }

  if (stopPropagation) {
    e.preventDefault();
    e.stopPropagation();
  }
};

/**
 * Handle a mouse up or touch end event.
 * @param {!Event} e A mouse up or touch end event.
 * @package
 */
Blockly.Gesture.prototype.handleUp = function(e) {
  this.updateFromEvent_(e);
  Blockly.longStop_();

  if (this.isEnding_) {
    return;
  }
  this.isEnding_ = true;
  // The ordering of these checks is important: drags have higher priority than
  // clicks.  Fields have higher priority than blocks; blocks have higher
  // priority than workspaces.
  // The ordering within drags does not matter, because the three types of
  // dragging are exclusive.
  if (this.isDraggingBubble_) {
    this.bubbleDragger_.endBubbleDrag(e, this.currentDragDeltaXY_);
  } else if (this.isDraggingBlock_) {
    this.blockDragger_.endBlockDrag(e, this.currentDragDeltaXY_);
  } else if (this.isBoxSelecting_) {
    this.endBoxSelect_();
  } else if (this.isBoxDragging_) {
    this.endBoxDrag_();
  } else if (this.isDraggingWorkspace_) {
    this.workspaceDragger_.endDrag(this.currentDragDeltaXY_);
  } else if (this.isBubbleClick_()) {
    // Bubbles are in front of all fields and blocks.
    this.doBubbleClick_();
  } else if (this.isFieldClick_()) {
    this.doFieldClick_();
  } else if (this.isBlockClick_()) {
    this.doBlockClick_();
  } else if (this.isWorkspaceClick_()) {
    this.doWorkspaceClick_();
  }

  e.preventDefault();
  e.stopPropagation();

  this.dispose();
};

/**
 * Cancel an in-progress gesture.  If a workspace or block drag is in progress,
 * end the drag at the most recent location.
 * @package
 */
Blockly.Gesture.prototype.cancel = function() {
  // Disposing of a block cancels in-progress drags, but dragging to a delete
  // area disposes of a block and leads to recursive disposal. Break that cycle.
  if (this.isEnding_) {
    return;
  }
  this.isEnding_ = true;
  Blockly.longStop_();
  if (this.isDraggingBubble_) {
    this.bubbleDragger_.endBubbleDrag(this.mostRecentEvent_,
        this.currentDragDeltaXY_);
  } else if (this.isDraggingBlock_) {
    this.blockDragger_.endBlockDrag(this.mostRecentEvent_,
        this.currentDragDeltaXY_);
  } else if (this.isBoxSelecting_) {
    this.endBoxSelect_();
  } else if (this.isBoxDragging_) {
    this.endBoxDrag_();
  } else if (this.isDraggingWorkspace_) {
    this.workspaceDragger_.endDrag(this.currentDragDeltaXY_);
  }
  this.dispose();
};

/**
 * Handle a real or faked right-click event by showing a context menu.
 * @param {!Event} e A mouse move or touch move event.
 * @package
 */
Blockly.Gesture.prototype.handleRightClick = function(e) {
  if (this.targetBlock_) {
    this.bringBlockToFront_();
    Blockly.hideChaff(this.flyout_);
    this.targetBlock_.showContextMenu_(e);
  } else if (this.startBubble_) {
    this.startBubble_.showContextMenu_(e);
  } else if (this.startWorkspace_ && !this.flyout_) {
    Blockly.hideChaff();
    this.startWorkspace_.showContextMenu_(e);
  }

  // TODO: Handle right-click on a bubble.
  e.preventDefault();
  e.stopPropagation();

  this.dispose();
};

/**
 * Handle a mousedown/touchstart event on a workspace.
 * @param {!Event} e A mouse down or touch start event.
 * @param {!Blockly.Workspace} ws The workspace the event hit.
 * @package
 */
Blockly.Gesture.prototype.handleWsStart = function(e, ws) {
  goog.asserts.assert(!this.hasStarted_,
      'Tried to call gesture.handleWsStart, but the gesture had already been ' +
      'started.');
  this.setStartWorkspace_(ws);
  this.mostRecentEvent_ = e;
  this.doStart(e);
};

/**
 * Handle a mousedown/touchstart event on a flyout.
 * @param {!Event} e A mouse down or touch start event.
 * @param {!Blockly.Flyout} flyout The flyout the event hit.
 * @package
 */
Blockly.Gesture.prototype.handleFlyoutStart = function(e, flyout) {
  goog.asserts.assert(!this.hasStarted_,
      'Tried to call gesture.handleFlyoutStart, but the gesture had already ' +
      'been started.');
  this.setStartFlyout_(flyout);
  this.handleWsStart(e, flyout.getWorkspace());
};

/**
 * Handle a mousedown/touchstart event on a block.
 * @param {!Event} e A mouse down or touch start event.
 * @param {!Blockly.BlockSvg} block The block the event hit.
 * @package
 */
Blockly.Gesture.prototype.handleBlockStart = function(e, block) {
  goog.asserts.assert(!this.hasStarted_,
      'Tried to call gesture.handleBlockStart, but the gesture had already ' +
      'been started.');
  this.setStartBlock(block);
  this.mostRecentEvent_ = e;
};

/**
 * Handle a mousedown/touchstart event on a bubble.
 * @param {!Event} e A mouse down or touch start event.
 * @param {!Blockly.Bubble} bubble The bubble the event hit.
 * @package
 */
Blockly.Gesture.prototype.handleBubbleStart = function(e, bubble) {
  goog.asserts.assert(!this.hasStarted_,
      'Tried to call gesture.handleBubbleStart, but the gesture had already ' +
      'been started.');
  this.setStartBubble(bubble);
  this.mostRecentEvent_ = e;
};

/* Begin functions defining what actions to take to execute clicks on each type
 * of target.  Any developer wanting to add behaviour on clicks should modify
 * only this code. */

/**
 * Execute a bubble click.
 * @private
 */
Blockly.Gesture.prototype.doBubbleClick_ = function() {
  // TODO (github.com/google/blockly/issues/1673): Consistent handling of single
  // clicks.
  this.startBubble_.setFocus && this.startBubble_.setFocus();
  this.startBubble_.select && this.startBubble_.select();
};

/**
 * Execute a field click.
 * @private
 */
Blockly.Gesture.prototype.doFieldClick_ = function() {
  this.startField_.showEditor_();
  this.bringBlockToFront_();
};

/**
 * Execute a block click.
 * @private
 */
Blockly.Gesture.prototype.doBlockClick_ = function() {
  // Block click in an autoclosing flyout.
  if (this.flyout_ && this.flyout_.autoClose) {
    if (!this.targetBlock_.disabled) {
      if (!Blockly.Events.getGroup()) {
        Blockly.Events.setGroup(true);
      }
      var newBlock = this.flyout_.createBlock(this.targetBlock_);
      newBlock.scheduleSnapAndBump();
    }
  } else {
    // Ctrl+click toggles the clicked block in the box selection instead of
    // running the normal click path.
    if (this.ctrlHeld_ && this.startWorkspace_.options.hasBoxSelect) {
      this.toggleBoxSelection_(this.startBlock_);
      this.bringBlockToFront_();
      return;
    }
    // A field is being edited if either the WidgetDiv or DropDownDiv is currently open.
    // If a field is being edited, don't fire any click events.
    var fieldEditing = Blockly.WidgetDiv.isVisible() || Blockly.DropDownDiv.isVisible();
    if (!fieldEditing) {
      Blockly.Events.fire(
          new Blockly.Events.Ui(this.startBlock_, 'click', undefined, undefined));
      // Scratch-specific: also fire a "stack click" event for this stack.
      // This is used to toggle the stack when any block in the stack is clicked.
      var rootBlock = this.startBlock_.getRootBlock();
      Blockly.Events.fire(
          new Blockly.Events.Ui(rootBlock, 'stackclick', undefined, undefined));
    }
  }
  this.bringBlockToFront_();
  Blockly.Events.setGroup(false);
};

/**
 * Execute a workspace click.
 * @private
 */
Blockly.Gesture.prototype.doWorkspaceClick_ = function() {
  if (Blockly.selected) {
    Blockly.selected.unselect();
  }
  // Clicking empty workspace drops the box selection too.
  if (this.startWorkspace_.clearBoxSelection) {
    this.startWorkspace_.clearBoxSelection();
  }
};

/* End functions defining what actions to take to execute clicks on each type
 * of target. */

// TODO (fenichel): Move bubbles to the front.
/**
 * Move the dragged/clicked block to the front of the workspace so that it is
 * not occluded by other blocks.
 * @private
 */
Blockly.Gesture.prototype.bringBlockToFront_ = function() {
  // Blocks in the flyout don't overlap, so skip the work.
  if (this.targetBlock_ && !this.flyout_) {
    this.targetBlock_.bringToFront();
  }
};

/* Begin functions for populating a gesture at mouse down. */

/**
 * Record the field that a gesture started on.
 * @param {Blockly.Field} field The field the gesture started on.
 * @package
 */
Blockly.Gesture.prototype.setStartField = function(field) {
  goog.asserts.assert(!this.hasStarted_,
      'Tried to call gesture.setStartField, but the gesture had already been ' +
      'started.');
  if (!this.startField_) {
    this.startField_ = field;
  }
};

/**
 * Record the bubble that a gesture started on
 * @param {Blockly.Bubble} bubble The bubble the gesture started on.
 * @package
 */
Blockly.Gesture.prototype.setStartBubble = function(bubble) {
  if (!this.startBubble_) {
    this.startBubble_ = bubble;
  }
};

/**
 * Record the block that a gesture started on, and set the target block
 * appropriately.
 * @param {Blockly.BlockSvg} block The block the gesture started on.
 * @package
 */
Blockly.Gesture.prototype.setStartBlock = function(block) {
  // If the gesture already went through a bubble, don't set the start block.
  if (!this.startBlock_ && !this.startBubble_) {
    this.startBlock_ = block;
    this.shouldDuplicateOnDrag_ =
        Blockly.scratchBlocksUtils.isShadowArgumentReporter(block);
    if (block.isInFlyout && block != block.getRootBlock()) {
      this.setTargetBlock_(block.getRootBlock());
    } else {
      this.setTargetBlock_(block);
    }
  }
};

/**
 * Record the block that a gesture targets, meaning the block that will be
 * dragged if this turns into a drag.  If this block is a shadow, that will be
 * its first non-shadow parent.
 * @param {Blockly.BlockSvg} block The block the gesture targets.
 * @private
 */
Blockly.Gesture.prototype.setTargetBlock_ = function(block) {
  if (block.isShadow() && !this.shouldDuplicateOnDrag_) {
    this.setTargetBlock_(block.getParent());
  } else {
    this.targetBlock_ = block;
  }
};

/**
 * Record the workspace that a gesture started on.
 * @param {Blockly.WorkspaceSvg} ws The workspace the gesture started on.
 * @private
 */
Blockly.Gesture.prototype.setStartWorkspace_ = function(ws) {
  if (!this.startWorkspace_) {
    this.startWorkspace_ = ws;
  }
};

/**
 * Record the flyout that a gesture started on.
 * @param {Blockly.Flyout} flyout The flyout the gesture started on.
 * @private
 */
Blockly.Gesture.prototype.setStartFlyout_ = function(flyout) {
  if (!this.flyout_) {
    this.flyout_ = flyout;
  }
};

/* End functions for populating a gesture at mouse down. */

/* Begin helper functions defining types of clicks.  Any developer wanting
 * to change the definition of a click should modify only this code. */

/**
 * Whether this gesture is a click on a bubble.  This should only be called when
 * ending a gesture (mouse up, touch end).
 * @return {boolean} whether this gesture was a click on a bubble.
 * @private
 */
Blockly.Gesture.prototype.isBubbleClick_ = function() {
  // A bubble click starts on a bubble and never escapes the drag radius.
  var hasStartBubble = !!this.startBubble_;
  return hasStartBubble && !this.hasExceededDragRadius_;
};

/**
 * Whether this gesture is a click on a block.  This should only be called when
 * ending a gesture (mouse up, touch end).
 * @return {boolean} whether this gesture was a click on a block.
 * @private
 */
Blockly.Gesture.prototype.isBlockClick_ = function() {
  // A block click starts on a block, never escapes the drag radius, and is not
  // a field click.
  var hasStartBlock = !!this.startBlock_;
  return hasStartBlock && !this.hasExceededDragRadius_ && !this.isFieldClick_();
};

/**
 * Whether this gesture is a click on a field.  This should only be called when
 * ending a gesture (mouse up, touch end).
 * @return {boolean} whether this gesture was a click on a field.
 * @private
 */
Blockly.Gesture.prototype.isFieldClick_ = function() {
  var fieldEditable = this.startField_ ?
      this.startField_.isCurrentlyEditable() : false;
  return fieldEditable && !this.hasExceededDragRadius_;
};

/**
 * Whether this gesture is a click on a workspace.  This should only be called
 * when ending a gesture (mouse up, touch end).
 * @return {boolean} whether this gesture was a click on a workspace.
 * @private
 */
Blockly.Gesture.prototype.isWorkspaceClick_ = function() {
  var onlyTouchedWorkspace = !this.startBlock_ && !this.startBubble_ &&
      !this.startField_;
  return onlyTouchedWorkspace && !this.hasExceededDragRadius_;
};

/* End helper functions defining types of clicks. */

/**
 * Whether this gesture is a drag of either a workspace or block.
 * This function is called externally to block actions that cannot be taken
 * mid-drag (e.g. using the keyboard to delete the selected blocks).
 * @return {boolean} true if this gesture is a drag of a workspace or block.
 * @package
 */
Blockly.Gesture.prototype.isDragging = function() {
  return this.isDraggingWorkspace_ || this.isDraggingBlock_ ||
      this.isDraggingBubble_ || this.isBoxSelecting_ || this.isBoxDragging_;
};

/**
 * Whether this gesture has already been started.  In theory every mouse down
 * has a corresponding mouse up, but in reality it is possible to lose a
 * mouse up, leaving an in-process gesture hanging.
 * @return {boolean} whether this gesture was a click on a workspace.
 * @package
 */
Blockly.Gesture.prototype.hasStarted = function() {
  return this.hasStarted_;
};

/* Scratch-specific */

/**
 * Don't even think about using this function before talking to rachel-fenichel.
 *
 * Force a drag to start without clicking and dragging the block itself.  Used
 * to attach duplicated blocks to the mouse pointer.
 * @param {!Object} fakeEvent An object with the properties needed to start a
 *     drag, including clientX and clientY.
 * @param {!Blockly.BlockSvg} block The block to start dragging.
 * @package
 */
Blockly.Gesture.prototype.forceStartBlockDrag = function(fakeEvent, block) {
  this.handleBlockStart(fakeEvent, block);
  this.handleWsStart(fakeEvent, block.workspace);
  this.isDraggingBlock_ = true;
  this.hasExceededDragRadius_ = true;
  this.startDraggingBlock_();
};

/**
 * Force a rigid, multi-block drag to start without clicking and dragging the
 * blocks themselves.  Used to attach duplicated box-selection blocks to the
 * mouse pointer (see scratchBlocksUtils.duplicateSelectionAndDragCallback).
 * Mirrors forceStartBlockDrag but drags a set of top-level blocks together,
 * exactly like a Ctrl+drag box-selection move (updateBoxDrag_ / endBoxDrag_).
 * @param {!Object} fakeEvent An object with the properties needed to start a
 *     drag, including clientX and clientY.
 * @param {!Array<!Blockly.BlockSvg>} blocks The top-level blocks to drag.
 * @package
 */
Blockly.Gesture.prototype.forceStartBoxDrag = function(fakeEvent, blocks) {
  this.handleBlockStart(fakeEvent, blocks[0]);
  this.handleWsStart(fakeEvent, blocks[0].workspace);
  var ws = blocks[0].workspace;
  this.boxDragBlocks_ = blocks.slice();
  this.boxDragOrigins_ = blocks.map(function(b) {
    return b.getRelativeToSurfaceXY();
  });
  this.boxDragTotal_ = new goog.math.Coordinate(0, 0);
  this.isBoxDragging_ = true;
  // Force the drag radius to already be exceeded so updateFromEvent_ never calls
  // updateIsDragging_. Otherwise the first real mouse move past the radius would
  // run updateIsDragging_ -> updateIsDraggingBlock_ and create a BlockDragger for
  // targetBlock_ (blocks[0]) alone, leaving every other copied block frozen in
  // place while only that one follows the cursor. forceStartBlockDrag sets the
  // same flag for the same reason (2026-10-17).
  this.hasExceededDragRadius_ = true;
  ws.setResizesEnabled(false);
};

/**
 * Duplicate the target block and start dragging the duplicated block.
 * This should be done once we are sure that it is a block drag, and no earlier.
 * Specifically for argument reporters in custom block defintions.
 * @private
 */
Blockly.Gesture.prototype.duplicateOnDrag_ = function() {
  var newBlock = null;
  Blockly.Events.disable();
  try {
    // Note: targetBlock_ should have no children.  If it has children we would
    // need to update shadow block IDs to avoid problems in the VM.
    // Resizes will be reenabled at the end of the drag.
    this.startWorkspace_.setResizesEnabled(false);
    var xmlBlock = Blockly.Xml.blockToDom(this.targetBlock_);
    newBlock = Blockly.Xml.domToBlock(xmlBlock, this.startWorkspace_);

    // Move the duplicate to original position.
    var xy = this.targetBlock_.getRelativeToSurfaceXY();
    newBlock.moveBy(xy.x, xy.y);
    newBlock.setShadow(false);
  } finally {
    Blockly.Events.enable();
  }
  if (!newBlock) {
    // Something went wrong.
    console.error('Something went wrong while duplicating a block.');
    return;
  }
  if (Blockly.Events.isEnabled()) {
    Blockly.Events.fire(new Blockly.Events.BlockCreate(newBlock));
  }
  newBlock.select();
  this.targetBlock_ = newBlock;
};
