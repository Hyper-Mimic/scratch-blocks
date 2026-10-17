/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2012 Google Inc.
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
 * @fileoverview Methods for graphically rendering a block as SVG.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

goog.provide('Blockly.BlockSvg');

goog.require('Blockly.Block');
goog.require('Blockly.BlockAnimations');
goog.require('Blockly.ContextMenu');
goog.require('Blockly.Events.Ui');
goog.require('Blockly.Events.BlockMove');
goog.require('Blockly.Grid');
goog.require('Blockly.RenderedConnection');
goog.require('Blockly.scratchBlocksUtils');
goog.require('Blockly.Tooltip');
goog.require('Blockly.Touch');
goog.require('Blockly.utils');

goog.require('goog.Timer');
goog.require('goog.asserts');
goog.require('goog.dom');
goog.require('goog.math.Coordinate');


/**
 * Class for a block's SVG representation.
 * Not normally called directly, workspace.newBlock() is preferred.
 * @param {!Blockly.Workspace} workspace The block's workspace.
 * @param {?string} prototypeName Name of the language object containing
 *     type-specific functions for this block.
 * @param {string=} opt_id Optional ID.  Use this ID if provided, otherwise
 *     create a new ID.  If the ID conflicts with an in-use ID, a new one will
 *     be generated.
 * @extends {Blockly.Block}
 * @constructor
 */
Blockly.BlockSvg = function(workspace, prototypeName, opt_id) {
  // Create core elements for the block.
  /**
   * @type {SVGElement}
   * @private
   */
  this.svgGroup_ = Blockly.utils.createSvgElement('g', {}, null);
  /** @type {SVGElement} */
  this.svgPath_ = Blockly.utils.createSvgElement('path',
      {'class': 'blocklyPath blocklyBlockBackground'},
      this.svgGroup_);
  this.svgPath_.tooltip = this;

  /** @type {boolean} */
  this.rendered = false;

  /**
   * Whether to move the block to the drag surface when it is dragged.
   * True if it should move, false if it should be translated directly.
   * @type {boolean}
   * @private
   */
  this.useDragSurface_ = Blockly.utils.is3dSupported() && !!workspace.blockDragSurface_;

  Blockly.Tooltip.bindMouseEvents(this.svgPath_);
  Blockly.BlockSvg.superClass_.constructor.call(this,
      workspace, prototypeName, opt_id);

  // Expose this block's ID on its top-level SVG group.
  if (this.svgGroup_.dataset) {
    this.svgGroup_.dataset.id = this.id;
  }
};
goog.inherits(Blockly.BlockSvg, Blockly.Block);

/**
 * Height of this block, not including any statement blocks above or below.
 * Height is in workspace units.
 */
Blockly.BlockSvg.prototype.height = 0;

/**
 * Width of this block, including any connected value blocks.
 * Width is in workspace units.
 */
Blockly.BlockSvg.prototype.width = 0;

/**
 * Minimum width of block if insertion marker; comes from inserting block.
 * @type {number}
 */
Blockly.BlockSvg.prototype.insertionMarkerMinWidth_ = 0;

/**
 * Opacity of this block between 0 and 1.
 * @type {number}
 * @private
 */
Blockly.BlockSvg.prototype.opacity_ = 1;

/**
 * Original location of block being dragged.
 * @type {goog.math.Coordinate}
 * @private
 */
Blockly.BlockSvg.prototype.dragStartXY_ = null;

/**
 * Whether the block glows as if running.
 * @type {boolean}
 * @private
 */
Blockly.BlockSvg.prototype.isGlowingBlock_ = false;

/**
 * Whether the block's whole stack glows as if running.
 * @type {boolean}
 * @private
 */
Blockly.BlockSvg.prototype.isGlowingStack_ = false;

/**
 * Constant for identifying rows that are to be rendered inline.
 * Don't collide with Blockly.INPUT_VALUE and friends.
 * @const
 */
Blockly.BlockSvg.INLINE = -1;

/**
 * Create and initialize the SVG representation of the block.
 * May be called more than once.
 */
Blockly.BlockSvg.prototype.initSvg = function() {
  goog.asserts.assert(this.workspace.rendered, 'Workspace is headless.');
  if (!this.isInsertionMarker()) { // Insertion markers not allowed to have inputs or icons
    // Input shapes are empty holes drawn when a value input is not connected.
    for (var i = 0, input; input = this.inputList[i]; i++) {
      input.init();
      input.initOutlinePath(this.svgGroup_);
    }
    var icons = this.getIcons();
    for (i = 0; i < icons.length; i++) {
      icons[i].createIcon();
    }
  }
  this.updateColour();
  this.updateMovable();
  if (!this.workspace.options.readOnly && !this.eventsInit_) {
    Blockly.bindEventWithChecks_(
        this.getSvgRoot(), 'mousedown', this, this.onMouseDown_);
  }
  this.eventsInit_ = true;

  if (!this.getSvgRoot().parentNode) {
    this.workspace.getCanvas().appendChild(this.getSvgRoot());
  }
};

/**
 * Select this block.  Highlight it visually.
 */
Blockly.BlockSvg.prototype.select = function() {
  if (this.isShadow() && this.getParent()) {
    // Shadow blocks should not be selected.
    this.getParent().select();
    return;
  }
  if (Blockly.selected == this) {
    return;
  }
  var oldId = null;
  if (Blockly.selected) {
    oldId = Blockly.selected.id;
    // Unselect any previously selected block.
    Blockly.Events.disable();
    try {
      Blockly.selected.unselect();
    } finally {
      Blockly.Events.enable();
    }
  }
  var event = new Blockly.Events.Ui(null, 'selected', oldId, this.id);
  event.workspaceId = this.workspace.id;
  Blockly.Events.fire(event);
  Blockly.selected = this;
  this.addSelect();
};

/**
 * Unselect this block.  Remove its highlighting.
 */
Blockly.BlockSvg.prototype.unselect = function() {
  if (Blockly.selected != this) {
    return;
  }
  var event = new Blockly.Events.Ui(null, 'selected', this.id, null);
  event.workspaceId = this.workspace.id;
  Blockly.Events.fire(event);
  Blockly.selected = null;
  this.removeSelect();
};

/**
 * Glow only this particular block, to highlight it visually as if it's running.
 * @param {boolean} isGlowingBlock Whether the block should glow.
 */
Blockly.BlockSvg.prototype.setGlowBlock = function(isGlowingBlock) {
  this.isGlowingBlock_ = isGlowingBlock;
  this.updateColour();
};

/**
 * Glow the stack starting with this block, to highlight it visually as if it's running.
 * @param {boolean} isGlowingStack Whether the stack starting with this block should glow.
 */
Blockly.BlockSvg.prototype.setGlowStack = function(isGlowingStack) {
  this.isGlowingStack_ = isGlowingStack;
  // Update the applied SVG filter if the property has changed
  var svg = this.getSvgRoot();
  if (this.isGlowingStack_ && !svg.hasAttribute('filter')) {
    var stackGlowFilterId = this.workspace.options.stackGlowFilterId || 'blocklyStackGlowFilter';
    svg.setAttribute('filter', 'url(#' + stackGlowFilterId + ')');
  } else if (!this.isGlowingStack_ && svg.hasAttribute('filter')) {
    svg.removeAttribute('filter');
  }
};

/**
 * Block's mutator icon (if any).
 * @type {Blockly.Mutator}
 */
Blockly.BlockSvg.prototype.mutator = null;

/**
 * Block's comment icon (if any).
 * @type {Blockly.Comment}
 */
Blockly.BlockSvg.prototype.comment = null;

/**
 * Block's warning icon (if any).
 * @type {Blockly.Warning}
 */
Blockly.BlockSvg.prototype.warning = null;

/**
 * Returns a list of mutator, comment, and warning icons.
 * @return {!Array} List of icons.
 */
Blockly.BlockSvg.prototype.getIcons = function() {
  var icons = [];
  if (this.mutator) {
    icons.push(this.mutator);
  }
  if (this.comment) {
    icons.push(this.comment);
  }
  if (this.warning) {
    icons.push(this.warning);
  }
  return icons;
};

Blockly.BlockSvg.prototype.intersects_ = true;

Blockly.BlockSvg.prototype.setIntersects = function(intersects) {
  if (intersects === this.intersects_) {
    return;
  }
  this.intersects_ = intersects;
  var root = this.getSvgRoot();
  if (!root) {
    return;
  }
  if (intersects) {
    root.style.display = '';
  } else {
    root.style.display = 'none';
  }
};

Blockly.BlockSvg.prototype.updateIntersectionObserver = function() {
  if (this.workspace.intersectionObserver) {
    if (this.getParent()) {
      this.workspace.intersectionObserver.unobserve(this);
      if (!this.intersects_) {
        this.setIntersects(true);
      }
    } else {
      this.workspace.intersectionObserver.observe(this);
    }
  }
};

/**
 * Set parent of this block to be a new block or null.
 * @param {Blockly.BlockSvg} newParent New parent block.
 */
Blockly.BlockSvg.prototype.setParent = function(newParent) {
  var oldParent = this.parentBlock_;
  if (newParent == oldParent) {
    return;
  }
  // PATCH 13 (2026-10-10): remember which stack this block is leaving. Both it
  // and the stack it joins changed shape; nothing else in the workspace did.
  var oldRoot = oldParent ? this.getRootBlock() : null;
  Blockly.Field.startCache();
  Blockly.BlockSvg.superClass_.setParent.call(this, newParent);
  Blockly.Field.stopCache();

  var svgRoot = this.getSvgRoot();

  // Bail early if workspace is clearing, or we aren't rendered.
  // We won't need to reattach ourselves anywhere.
  if (this.workspace.isClearing || !svgRoot) {
    return;
  }

  this.updateIntersectionObserver();

  // PATCH 9 (2026-10-10): connecting/disconnecting reparents the SVG and changes
  // which blocks are top-level, so the cached content box must be dropped.
  // PATCH 13 (2026-10-10): name the two stacks that were actually reshaped
  // instead of re-seeding every stack in the workspace.
  var newRoot = this.getRootBlock();
  if (oldRoot && oldRoot !== newRoot) {
    this.workspace.invalidateContentBounds_(oldRoot);
  }
  this.workspace.invalidateContentBounds_(newRoot);

  var oldXY = this.getRelativeToSurfaceXY();
  if (newParent) {
    newParent.getSvgRoot().appendChild(svgRoot);
    var newXY = this.getRelativeToSurfaceXY();
    // Move the connections to match the child's new position.
    this.moveConnections_(newXY.x - oldXY.x, newXY.y - oldXY.y);
    // If we are a shadow block, inherit tertiary colour.
    if (this.isShadow()) {
      this.setColour(this.getColour(), this.getColourSecondary(),
          newParent.getColourTertiary(), this.getColourQuaternary());
    }
  }
  // If we are losing a parent, we want to move our DOM element to the
  // root of the workspace.
  else if (oldParent) {
    this.workspace.getCanvas().appendChild(svgRoot);
    this.translate(oldXY.x, oldXY.y);
  }

};

/**
 * Return the coordinates of the top-left corner of this block relative to the
 * drawing surface's origin (0,0), in workspace units.
 * If the block is on the workspace, (0, 0) is the origin of the workspace
 * coordinate system.
 * This does not change with workspace scale.
 * @return {!goog.math.Coordinate} Object with .x and .y properties in
 *     workspace coordinates.
 */
Blockly.BlockSvg.prototype.getRelativeToSurfaceXY = function() {
  // The drawing surface is relative to either the workspace canvas
  // or to the drag surface group.
  var x = 0;
  var y = 0;

  var dragSurfaceGroup = this.useDragSurface_ ?
      this.workspace.blockDragSurface_.getGroup() : null;

  var element = this.getSvgRoot();
  if (element) {
    do {
      // Loop through this block and every parent.
      var xy = Blockly.utils.getRelativeXY(element);
      x += xy.x;
      y += xy.y;
      // If this element is the current element on the drag surface, include
      // the translation of the drag surface itself.
      if (this.useDragSurface_ &&
          this.workspace.blockDragSurface_.getCurrentBlock() == element) {
        var surfaceTranslation = this.workspace.blockDragSurface_.getSurfaceTranslation();
        x += surfaceTranslation.x;
        y += surfaceTranslation.y;
      }
      element = element.parentNode;
    } while (element && element != this.workspace.getCanvas() &&
        element != dragSurfaceGroup);
  }
  return new goog.math.Coordinate(x, y);
};

/**
 * Move a block by a relative offset.
 * @param {number} dx Horizontal offset in workspace units.
 * @param {number} dy Vertical offset in workspace units.
 */
Blockly.BlockSvg.prototype.moveBy = function(dx, dy) {
  goog.asserts.assert(!this.parentBlock_, 'Block has parent.');
  var eventsEnabled = Blockly.Events.isEnabled();
  if (eventsEnabled) {
    var event = new Blockly.Events.BlockMove(this);
  }
  var xy = this.getRelativeToSurfaceXY();
  this.translate(xy.x + dx, xy.y + dy);
  this.moveConnections_(dx, dy);
  if (eventsEnabled) {
    event.recordNew();
    Blockly.Events.fire(event);
  }
  // PATCH 13 (2026-10-10): name the stack being moved so only that stack has to
  // be re-measured, instead of the whole workspace.
  this.workspace.resizeContents(this.getRootBlock());
};

/**
 * Transforms a block by setting the translation on the transform attribute
 * of the block's SVG.
 * @param {number} x The x coordinate of the translation in workspace units.
 * @param {number} y The y coordinate of the translation in workspace units.
 */
Blockly.BlockSvg.prototype.translate = function(x, y) {
  this.getSvgRoot().setAttribute('transform',
      'translate(' + x + ',' + y + ')');
};

/**
 * Move this block to its workspace's drag surface, accounting for positioning.
 * Generally should be called at the same time as setDragging_(true).
 * Does nothing if useDragSurface_ is false.
 * @private
 */
Blockly.BlockSvg.prototype.moveToDragSurface_ = function() {
  if (!this.useDragSurface_) {
    return;
  }
  // The translation for drag surface blocks,
  // is equal to the current relative-to-surface position,
  // to keep the position in sync as it move on/off the surface.
  // This is in workspace coordinates.
  var xy = this.getRelativeToSurfaceXY();
  this.clearTransformAttributes_();
  this.workspace.blockDragSurface_.translateSurface(xy.x, xy.y);
  // Execute the move on the top-level SVG component
  this.workspace.blockDragSurface_.setBlocksAndShow(this.getSvgRoot());
};

/**
 * Move this block back to the workspace block canvas.
 * Generally should be called at the same time as setDragging_(false).
 * Does nothing if useDragSurface_ is false.
 * @param {!goog.math.Coordinate} newXY The position the block should take on
 *     on the workspace canvas, in workspace coordinates.
 * @private
 */
Blockly.BlockSvg.prototype.moveOffDragSurface_ = function(newXY) {
  if (!this.useDragSurface_) {
    return;
  }
  // Translate to current position, turning off 3d.
  this.translate(newXY.x, newXY.y);
  this.workspace.blockDragSurface_.clearAndHide(this.workspace.getCanvas());
};

/**
 * Move this block during a drag, taking into account whether we are using a
 * drag surface to translate blocks.
 * This block must be a top-level block.
 * @param {!goog.math.Coordinate} newLoc The location to translate to, in
 *     workspace coordinates.
 * @package
 */
Blockly.BlockSvg.prototype.moveDuringDrag = function(newLoc) {
  if (this.useDragSurface_) {
    this.workspace.blockDragSurface_.translateSurface(newLoc.x, newLoc.y);
  } else {
    this.svgGroup_.translate_ = 'translate(' + newLoc.x + ',' + newLoc.y + ')';
    this.svgGroup_.setAttribute('transform',
        this.svgGroup_.translate_ + this.svgGroup_.skew_);
  }
  // PATCH 9 (2026-10-10): the dragged block moved on the drag surface without
  // going through translate(), so drop the cached content box. Cheap defence;
  // the drop itself invalidates again via moveOffDragSurface_ -> translate.
  // PATCH 12 (2026-10-10): name the dragged stack so a per-frame drag only
  // re-measures that one stack rather than every stack in the workspace.
  this.workspace.invalidateContentBounds_(this.getRootBlock());
};

/**
 * Clear the block of transform="..." attributes.
 * Used when the block is switching from 3d to 2d transform or vice versa.
 * @private
 */
Blockly.BlockSvg.prototype.clearTransformAttributes_ = function() {
  Blockly.utils.removeAttribute(this.getSvgRoot(), 'transform');
};

/**
 * Snap this block to the nearest grid point.
 */
Blockly.BlockSvg.prototype.snapToGrid = function() {
  if (!this.workspace) {
    return;  // Deleted block.
  }
  if (this.workspace.isDragging()) {
    return;  // Don't bump blocks during a drag.
  }
  if (this.getParent()) {
    return;  // Only snap top-level blocks.
  }
  if (this.isInFlyout) {
    return;  // Don't move blocks around in a flyout.
  }
  var grid = this.workspace.getGrid();
  if (!grid || !grid.shouldSnap()) {
    return;  // Config says no snapping.
  }
  var spacing = grid.getSpacing();
  var half = spacing / 2;
  var xy = this.getRelativeToSurfaceXY();
  var dx = Math.round((xy.x - half) / spacing) * spacing + half - xy.x;
  var dy = Math.round((xy.y - half) / spacing) * spacing + half - xy.y;
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (dx != 0 || dy != 0) {
    this.moveBy(dx, dy);
  }
};

/**
 * Returns the coordinates of a bounding box describing the dimensions of this
 * block and any blocks stacked below it.
 * Coordinate system: workspace coordinates.
 * @return {!{topLeft: goog.math.Coordinate, bottomRight: goog.math.Coordinate}}
 *    Object with top left and bottom right coordinates of the bounding box.
 */
Blockly.BlockSvg.prototype.getBoundingRectangle = function() {
  var blockXY = this.getRelativeToSurfaceXY(this);
  var blockBounds = this.getHeightWidth();
  var topLeft;
  var bottomRight;
  if (this.RTL) {
    topLeft = new goog.math.Coordinate(blockXY.x - blockBounds.width,
        blockXY.y);
    bottomRight = new goog.math.Coordinate(blockXY.x,
        blockXY.y + blockBounds.height);
  } else {
    topLeft = new goog.math.Coordinate(blockXY.x, blockXY.y);
    bottomRight = new goog.math.Coordinate(blockXY.x + blockBounds.width,
        blockXY.y + blockBounds.height);
  }

  return {topLeft: topLeft, bottomRight: bottomRight};
};

/**
 * Set block opacity for SVG rendering.
 * @param {number} opacity Intended opacity, betweeen 0 and 1
 */
Blockly.BlockSvg.prototype.setOpacity = function(opacity) {
  this.opacity_ = opacity;
  if (this.rendered) {
    this.updateColour();
  }
};

/**
 * Get block opacity for SVG rendering.
 * @return {number} Intended opacity, betweeen 0 and 1
 */
Blockly.BlockSvg.prototype.getOpacity = function() {
  return this.opacity_;
};

/**
 * Set whether the block is collapsed or not.
 * @param {boolean} collapsed True if collapsed.
 */
Blockly.BlockSvg.prototype.setCollapsed = function(collapsed) {
  if (this.collapsed_ == collapsed) {
    return;
  }
  var renderList = [];
  // Show/hide the inputs.
  for (var i = 0, input; input = this.inputList[i]; i++) {
    renderList.push.apply(renderList, input.setVisible(!collapsed));
  }

  var COLLAPSED_INPUT_NAME = '_TEMP_COLLAPSED_INPUT';
  if (collapsed) {
    var icons = this.getIcons();
    for (var i = 0; i < icons.length; i++) {
      icons[i].setVisible(false);
    }
    var text = this.toString(Blockly.COLLAPSE_CHARS);
    this.appendDummyInput(COLLAPSED_INPUT_NAME).appendField(text).init();
  } else {
    this.removeInput(COLLAPSED_INPUT_NAME);
    // Clear any warnings inherited from enclosed blocks.
    this.setWarningText(null);
  }
  Blockly.BlockSvg.superClass_.setCollapsed.call(this, collapsed);

  if (!renderList.length) {
    // No child blocks, just render this block.
    renderList[0] = this;
  }
  if (this.rendered) {
    for (var i = 0, block; block = renderList[i]; i++) {
      block.render();
    }
    // Don't bump neighbours.
    // Although bumping neighbours would make sense, users often collapse
    // all their functions and store them next to each other.  Expanding and
    // bumping causes all their definitions to go out of alignment.
  }
};

/**
 * Open the next (or previous) FieldTextInput.
 * @param {Blockly.Field|Blockly.Block} start Current location.
 * @param {boolean} forward If true go forward, otherwise backward.
 */
Blockly.BlockSvg.prototype.tab = function(start, forward) {
  var list = this.createTabList_();
  var i = list.indexOf(start);
  if (i == -1) {
    // No start location, start at the beginning or end.
    i = forward ? -1 : list.length;
  }
  var target = list[forward ? i + 1 : i - 1];
  if (!target) {
    // Ran off of list.
    // If there is an output, tab up to that block.
    var outputBlock = this.outputConnection && this.outputConnection.targetBlock();
    if (outputBlock) {
      outputBlock.tab(this, forward);
    } else { // Otherwise, go to next / previous block, depending on value of `forward`
      var block = forward ? this.getNextBlock() : this.getPreviousBlock();
      if (block) {
        block.tab(this, forward);
      }
    }
  } else if (target instanceof Blockly.Field) {
    target.showEditor_();
  } else {
    target.tab(null, forward);
  }
};

/**
 * Create an ordered list of all text fields and connected inputs.
 * @return {!Array.<!Blockly.FieldTextInput|!Blockly.Input>} The ordered list.
 * @private
 */
Blockly.BlockSvg.prototype.createTabList_ = function() {
  // This function need not be efficient since it runs once on a keypress.
  var list = [];
  for (var i = 0, input; input = this.inputList[i]; i++) {
    for (var j = 0, field; field = input.fieldRow[j]; j++) {
      if (field instanceof Blockly.FieldTextInput) {
        // TODO(# 1276): Also support dropdown fields.
        list.push(field);
      }
    }
    if (input.connection) {
      var block = input.connection.targetBlock();
      if (block) {
        list.push(block);
      }
    }
  }
  return list;
};

/**
 * Handle a mouse-down on an SVG block.
 * @param {!Event} e Mouse down event or touch start event.
 * @private
 */
Blockly.BlockSvg.prototype.onMouseDown_ = function(e) {
  if (this.workspace && this.workspace.isDragging()) {
    return;
  }
  var gesture = this.workspace && this.workspace.getGesture(e);
  if (gesture) {
    gesture.handleBlockStart(e, this);
  }
};

/**
 * Load the block's help page in a new window.
 * @private
 */
Blockly.BlockSvg.prototype.showHelp_ = function() {
  var url = goog.isFunction(this.helpUrl) ? this.helpUrl() : this.helpUrl;
  if (url) {
    // @todo rewrite
    alert(url);
  }
};


/**
 * Show the context menu for this block.
 * @param {!Event} e Mouse event.
 * @private
 */
Blockly.BlockSvg.prototype.showContextMenu_ = function(e) {
  if (this.workspace.options.readOnly || !this.contextMenu) {
    return;
  }
  // Save the current block in a variable for use in closures.
  var block = this;
  var ws = this.workspace;
  var menuOptions = [];
  // Right-clicking a box-selected block offers to delete or duplicate the whole
  // selection, rather than just this one block (2026-10-17).
  if (ws.isBlockBoxSelected && ws.isBlockBoxSelected(this) &&
      ws.getBoxSelection().size) {
    var selection = Array.from(ws.getBoxSelection());
    menuOptions.push(Blockly.ContextMenu.selectionDuplicateOption(selection, e));
    menuOptions.push(Blockly.ContextMenu.selectionDeleteOption(selection));
  } else if (this.isDeletable() && this.isMovable() && !block.isInFlyout) {
    menuOptions.push(
        Blockly.ContextMenu.blockDuplicateOption(block, e));
    if (this.isEditable() && this.workspace.options.comments) {
      menuOptions.push(Blockly.ContextMenu.blockCommentOption(block));
    }
    menuOptions.push(Blockly.ContextMenu.blockDeleteOption(block));
  } else if (this.parentBlock_ && this.isShadow_) {
    this.parentBlock_.showContextMenu_(e);
    return;
  }

  // Allow the block to add or modify menuOptions.
  if (this.customContextMenu) {
    this.customContextMenu(menuOptions);
  }
  Blockly.ContextMenu.show(e, menuOptions, this.RTL);
  Blockly.ContextMenu.currentBlock = this;
};

/**
 * Move the connections for this block and all blocks attached under it.
 * Also update any attached bubbles.
 * @param {number} dx Horizontal offset from current location, in workspace
 *     units.
 * @param {number} dy Vertical offset from current location, in workspace
 *     units.
 * @private
 */
Blockly.BlockSvg.prototype.moveConnections_ = function(dx, dy) {
  if (!this.rendered) {
    // Rendering is required to lay out the blocks.
    // This is probably an invisible block attached to a collapsed block.
    return;
  }
  var myConnections = this.getConnections_(false);
  for (var i = 0; i < myConnections.length; i++) {
    myConnections[i].moveBy(dx, dy);
  }
  var icons = this.getIcons();
  for (i = 0; i < icons.length; i++) {
    icons[i].computeIconLocation();
  }

  // Recurse through all blocks attached under this one.
  for (i = 0; i < this.childBlocks_.length; i++) {
    this.childBlocks_[i].moveConnections_(dx, dy);
  }
};

/**
 * Recursively adds or removes the dragging class to this node and its children.
 * @param {boolean} adding True if adding, false if removing.
 * @package
 */
Blockly.BlockSvg.prototype.setDragging = function(adding) {
  if (adding) {
    var group = this.getSvgRoot();
    group.translate_ = '';
    group.skew_ = '';
    Blockly.draggingConnections_ =
        Blockly.draggingConnections_.concat(this.getConnections_(true));
    Blockly.utils.addClass(
        /** @type {!Element} */ (this.svgGroup_), 'blocklyDragging');
  } else {
    Blockly.draggingConnections_ = [];
    Blockly.utils.removeClass(
        /** @type {!Element} */ (this.svgGroup_), 'blocklyDragging');
  }
  // Recurse through all blocks attached under this one.
  for (var i = 0; i < this.childBlocks_.length; i++) {
    this.childBlocks_[i].setDragging(adding);
  }
};

/**
 * Add or remove the UI indicating if this block is movable or not.
 */
Blockly.BlockSvg.prototype.updateMovable = function() {
  if (this.isMovable()) {
    Blockly.utils.addClass(
        /** @type {!Element} */ (this.svgGroup_), 'blocklyDraggable');
  } else {
    Blockly.utils.removeClass(
        /** @type {!Element} */ (this.svgGroup_), 'blocklyDraggable');
  }
};

/**
 * Set whether this block is movable or not.
 * @param {boolean} movable True if movable.
 */
Blockly.BlockSvg.prototype.setMovable = function(movable) {
  Blockly.BlockSvg.superClass_.setMovable.call(this, movable);
  this.updateMovable();
};

/**
 * Set whether this block is editable or not.
 * @param {boolean} editable True if editable.
 */
Blockly.BlockSvg.prototype.setEditable = function(editable) {
  Blockly.BlockSvg.superClass_.setEditable.call(this, editable);
  var icons = this.getIcons();
  for (var i = 0; i < icons.length; i++) {
    icons[i].updateEditable();
  }
};

/**
 * Set whether this block is a shadow block or not.
 * @param {boolean} shadow True if a shadow.
 */
Blockly.BlockSvg.prototype.setShadow = function(shadow) {
  Blockly.BlockSvg.superClass_.setShadow.call(this, shadow);
  this.updateColour();
};

/**
 * Set whether this block is an insertion marker block or not.
 * @param {boolean} insertionMarker True if an insertion marker.
 * @param {Number=} opt_minWidth Optional minimum width of the marker.
 */
Blockly.BlockSvg.prototype.setInsertionMarker = function(insertionMarker, opt_minWidth) {
  Blockly.BlockSvg.superClass_.setInsertionMarker.call(this, insertionMarker);
  this.insertionMarkerMinWidth_ = opt_minWidth;
  this.updateColour();
};

/**
 * Return the root node of the SVG or null if none exists.
 * @return {Element} The root SVG node (probably a group).
 */
Blockly.BlockSvg.prototype.getSvgRoot = function() {
  return this.svgGroup_;
};

/**
 * Dispose of this block.
 * @param {boolean} healStack If true, then try to heal any gap by connecting
 *     the next statement with the previous statement.  Otherwise, dispose of
 *     all children of this block.
 * @param {boolean} animate If true, show a disposal animation and sound.
 */
Blockly.BlockSvg.prototype.dispose = function(healStack, animate) {
  if (!this.workspace) {
    // The block has already been deleted.
    return;
  }
  Blockly.Tooltip.hide();
  Blockly.Field.startCache();
  // Save the block's workspace temporarily so we can resize the
  // contents once the block is disposed.
  var blockWorkspace = this.workspace;
  // PATCH 13 (2026-10-10): disposing an N-deep stack runs this method N times and
  // each run used to end with a bare resizeContents() -- N full O(all blocks)
  // metric recomputes. Remember which stack this block belonged to (getRootBlock()
  // is unreachable once superClass_.dispose has run) and bracket the whole
  // disposal in one batch, so the workspace resizes once, for that stack only.
  var contentRoot = this.getRootBlock();
  blockWorkspace.beginContentUpdate_();
  try {
    // If this block is being dragged, unlink the mouse events.
    if (Blockly.selected == this) {
      this.unselect();
      this.workspace.cancelCurrentGesture();
    }
    // If this block has a context menu open, close it.
    if (Blockly.ContextMenu.currentBlock == this) {
      Blockly.ContextMenu.hide();
    }

    if (animate && this.rendered) {
      this.unplug(healStack);
      Blockly.BlockAnimations.disposeUiEffect(this);
    }
    // Stop rerendering.
    this.rendered = false;

    Blockly.Events.disable();
    try {
      var icons = this.getIcons();
      for (var i = 0; i < icons.length; i++) {
        icons[i].dispose();
      }
    } finally {
      Blockly.Events.enable();
    }
    Blockly.BlockSvg.superClass_.dispose.call(this, healStack);

    if (blockWorkspace.intersectionObserver) {
      blockWorkspace.intersectionObserver.unobserve(this);
    }
    goog.dom.removeNode(this.svgGroup_);
    blockWorkspace.resizeContents(contentRoot);
    // Sever JavaScript to DOM connections.
    this.svgGroup_ = null;
    this.svgPath_ = null;
  } finally {
    Blockly.Field.stopCache();
    blockWorkspace.endContentUpdate_();
  }
};

/**
 * Enable or disable a block.
 */
Blockly.BlockSvg.prototype.updateDisabled = function() {
  // not supported
};

/**
 * Returns the comment on this block (or '' if none).
 * @return {string} Block's comment.
 */
Blockly.BlockSvg.prototype.getCommentText = function() {
  if (this.comment) {
    var comment = this.comment.getText();
    // Trim off trailing whitespace.
    return comment.replace(/\s+$/, '').replace(/ +\n/g, '\n');
  }
  return '';
};

/**
 * Set this block's comment text.
 * @param {?string} text The text, or null to delete.
 * @param {string=} commentId Id of the comment, or a new one will be generated if not provided.
 * @param {number=} commentX Optional x position for scratch comment in workspace coordinates
 * @param {number=} commentY Optional y position for scratch comment in workspace coordinates
 * @param {boolean=} minimized Optional minimized state for scratch comment, defaults to false
 */
Blockly.BlockSvg.prototype.setCommentText = function(text, commentId,
    commentX, commentY, minimized) {
  var changedState = false;
  if (goog.isString(text)) {
    if (!this.comment) {
      this.comment = new Blockly.ScratchBlockComment(this, text, commentId,
          commentX, commentY, minimized);
      changedState = true;
    } else {
      this.comment.setText(/** @type {string} */ (text));
    }
  } else {
    if (this.comment) {
      this.comment.dispose();
      changedState = true;
    }
  }
  if (changedState && this.rendered) {
    this.render();
    if (goog.isString(text)) {
      this.comment.setVisible(true);
    }
    // Adding or removing a comment icon will cause the block to change shape.
    this.bumpNeighbours_();
  }
};

/**
 * Set this block's warning text.
 * @param {?string} text The text, or null to delete.
 * @param {string=} opt_id An optional ID for the warning text to be able to
 *     maintain multiple warnings.
 */
Blockly.BlockSvg.prototype.setWarningText = function(text, opt_id) {
  if (!this.setWarningText.pid_) {
    // Create a database of warning PIDs.
    // Only runs once per block (and only those with warnings).
    this.setWarningText.pid_ = Object.create(null);
  }
  var id = opt_id || '';
  if (!id) {
    // Kill all previous pending processes, this edit supersedes them all.
    for (var n in this.setWarningText.pid_) {
      clearTimeout(this.setWarningText.pid_[n]);
      delete this.setWarningText.pid_[n];
    }
  } else if (this.setWarningText.pid_[id]) {
    // Only queue up the latest change.  Kill any earlier pending process.
    clearTimeout(this.setWarningText.pid_[id]);
    delete this.setWarningText.pid_[id];
  }
  if (this.workspace.isDragging()) {
    // Don't change the warning text during a drag.
    // Wait until the drag finishes.
    var thisBlock = this;
    this.setWarningText.pid_[id] = setTimeout(function() {
      if (thisBlock.workspace) {  // Check block wasn't deleted.
        delete thisBlock.setWarningText.pid_[id];
        thisBlock.setWarningText(text, id);
      }
    }, 100);
    return;
  }
  if (this.isInFlyout) {
    text = null;
  }

  var changedState = false;
  if (goog.isString(text)) {
    if (!this.warning) {
      this.warning = new Blockly.Warning(this);
      changedState = true;
    }
    this.warning.setText(/** @type {string} */ (text), id);
  } else {
    // Dispose all warnings if no ID is given.
    if (this.warning && !id) {
      this.warning.dispose();
      changedState = true;
    } else if (this.warning) {
      var oldText = this.warning.getText();
      this.warning.setText('', id);
      var newText = this.warning.getText();
      if (!newText) {
        this.warning.dispose();
      }
      changedState = oldText != newText;
    }
  }
  if (changedState && this.rendered) {
    this.render();
    // Adding or removing a warning icon will cause the block to change shape.
    this.bumpNeighbours_();
  }
};

/**
 * Give this block a mutator dialog.
 * @param {Blockly.Mutator} mutator A mutator dialog instance or null to remove.
 */
Blockly.BlockSvg.prototype.setMutator = function(mutator) {
  if (this.mutator && this.mutator !== mutator) {
    this.mutator.dispose();
  }
  if (mutator) {
    mutator.block_ = this;
    this.mutator = mutator;
    mutator.createIcon();
  }
};

/**
 * Select this block.  Highlight it visually.
 */
Blockly.BlockSvg.prototype.addSelect = function() {
  Blockly.utils.addClass(
      /** @type {!Element} */ (this.svgGroup_), 'blocklySelected');
};

/**
 * Unselect this block.  Remove its highlighting.
 */
Blockly.BlockSvg.prototype.removeSelect = function() {
  Blockly.utils.removeClass(
      /** @type {!Element} */ (this.svgGroup_),  'blocklySelected');
};

/**
 * Whether the given workspace-aligned rectangle intersects this block's
 * actual SVG shape rather than its bounding box. A rectangle drawn over the
 * empty space beside a C shape, a hat's overhang or a round reporter's
 * bounding-box corners does not select the block; a rectangle clipping any
 * part of the drawn shape does. Used by the box-selection hit test
 * (core/gesture.js updateBoxSelect_).
 * @param {number} x Rectangle left edge, workspace units.
 * @param {number} y Rectangle top edge, workspace units.
 * @param {number} width Rectangle width, workspace units.
 * @param {number} height Rectangle height, workspace units.
 * @return {boolean} True if the rectangle intersects the block's shape.
 */
Blockly.BlockSvg.prototype.intersectsWorkspaceRect = function(x, y, width,
    height) {
  var polygons = this.getCollisionPolygons_();
  if (!polygons.length) {
    return false;
  }
  var xy = this.getRelativeToSurfaceXY();
  for (var p = 0; p < polygons.length; p++) {
    if (Blockly.BlockSvg.rectIntersectsPolygon_(x, y, width, height,
        polygons[p], xy.x, xy.y)) {
      return true;
    }
  }
  return false;
};

/**
 * This block's collision outline as a list of polygons in block-local
 * coordinates: the main path plus every input outline (the inside of a C
 * shape counts as part of the block). Parsed from the rendered SVG paths and
 * cached; the cache is dropped on every render.
 *
 * Only SVG path elements are considered. HTML overlays that sit on top of a
 * block are NOT part of the hit area: the inline text editor's input
 * (FieldTextInput's .blocklyHtmlInput inside the WidgetDiv) and any other
 * non-SVG element are excluded, so a rectangle overlapping only such an
 * overlay does not select the block.
 * @return {!Array.<!Array.<!Array.<number>>>} Polygons as [x, y] vertex lists.
 * @private
 */
Blockly.BlockSvg.prototype.getCollisionPolygons_ = function() {
  if (this.collisionPolygons_) {
    return this.collisionPolygons_;
  }
  var polygons = [];
  if (this.svgPath_) {
    var main = Blockly.BlockSvg.parsePathToPolygon_(
        this.svgPath_.getAttribute('d'));
    if (main.length > 2) {
      polygons.push(main);
    }
  }
  for (var i = 0; i < this.inputList.length; i++) {
    var outline = this.inputList[i].outlinePath;
    if (outline) {
      var poly = Blockly.BlockSvg.parsePathToPolygon_(
          outline.getAttribute('d'));
      if (poly.length > 2) {
        polygons.push(poly);
      }
    }
  }
  this.collisionPolygons_ = polygons;
  return polygons;
};

/**
 * Parse an SVG path data string into a polygon vertex list. Arcs are sampled
 * into line segments (about 10 degrees per segment), so rounded corners,
 * notches and hat overhangs keep their shape to within a couple of workspace
 * units. Handles the M/L/H/V/Q/C/A/Z commands scratch-blocks emits (cubic
 * Béziers via 'C'/'c' are used for hat tops and connection notches).
 * @param {string} d The path data.
 * @return {!Array.<!Array.<number>>} [[x, y], ...] vertices, path-local.
 * @private
 */
Blockly.BlockSvg.parsePathToPolygon_ = function(d) {
  var points = [];
  if (!d) {
    return points;
  }
  var tokens = d.match(/[MLAQZHVmlaqzhvCc]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) {
    return points;
  }
  var cmd = 'M';
  var cx = 0;
  var cy = 0;
  var sx = 0;
  var sy = 0;
  var i = 0;
  var num = function() {
    return parseFloat(tokens[i++]);
  };
  while (i < tokens.length) {
    var t = tokens[i];
    if (/[MLAQZHVmlaqzhvCc]/.test(t)) {
      cmd = t;
      i++;
    }
    var abs = cmd === cmd.toUpperCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        var mx = num();
        var my = num();
        if (!abs) {
          mx += cx;
          my += cy;
        }
        cx = mx;
        cy = my;
        sx = mx;
        sy = my;
        points.push([cx, cy]);
        // After a moveto, further coordinate pairs are implicit linetos.
        cmd = abs ? 'L' : 'l';
        break;
      }
      case 'L': {
        var lx = num();
        var ly = num();
        if (!abs) {
          lx += cx;
          ly += cy;
        }
        cx = lx;
        cy = ly;
        points.push([cx, cy]);
        break;
      }
      case 'H': {
        var hx = num();
        if (!abs) {
          hx += cx;
        }
        cx = hx;
        points.push([cx, cy]);
        break;
      }
      case 'V': {
        var vy2 = num();
        if (!abs) {
          vy2 += cy;
        }
        cy = vy2;
        points.push([cx, cy]);
        break;
      }
      case 'Q': {
        var qx = num();
        var qy = num();
        var qx2 = num();
        var qy2 = num();
        if (!abs) {
          qx += cx;
          qy += cy;
          qx2 += cx;
          qy2 += cy;
        }
        for (var s = 1; s <= 6; s++) {
          var u = s / 6;
          points.push([
            (1 - u) * (1 - u) * cx + 2 * (1 - u) * u * qx + u * u * qx2,
            (1 - u) * (1 - u) * cy + 2 * (1 - u) * u * qy + u * u * qy2
          ]);
        }
        cx = qx2;
        cy = qy2;
        break;
      }
      case 'C': {
        var c1x = num();
        var c1y = num();
        var c2x = num();
        var c2y = num();
        var ex = num();
        var ey = num();
        if (!abs) {
          c1x += cx; c1y += cy;
          c2x += cx; c2y += cy;
          ex += cx; ey += cy;
        }
        // Sample the cubic Bézier (scratch-blocks draws hat tops and connection
        // notches with 'c', which is otherwise dropped by this parser).
        for (var s = 1; s <= 8; s++) {
          var u = s / 8;
          var mu = 1 - u;
          points.push([
            mu * mu * mu * cx + 3 * mu * mu * u * c1x +
                3 * mu * u * u * c2x + u * u * u * ex,
            mu * mu * mu * cy + 3 * mu * mu * u * c1y +
                3 * mu * u * u * c2y + u * u * u * ey
          ]);
        }
        cx = ex;
        cy = ey;
        break;
      }
      case 'A': {
        var rx = num();
        var ry = num();
        var rot = num() * Math.PI / 180;
        var largeArc = num();
        var sweep = num();
        var ax = num();
        var ay = num();
        if (!abs) {
          ax += cx;
          ay += cy;
        }
        Blockly.BlockSvg.arcToPolyline_(cx, cy, rx, ry, rot, largeArc, sweep,
            ax, ay, points);
        cx = ax;
        cy = ay;
        break;
      }
      case 'Z': {
        cx = sx;
        cy = sy;
        break;
      }
      default:
        // Unknown command: cannot recover the argument count reliably.
        i = tokens.length;
        break;
    }
  }
  return points;
};

/**
 * Append a polyline sampling of an SVG elliptical arc (endpoint parameter
 * form) to a vertex list. Standard endpoint-to-center conversion, sampled at
 * about 10 degrees per segment.
 * @param {number} x1 Start point x.
 * @param {number} y1 Start point y.
 * @param {number} rx Ellipse radius x.
 * @param {number} ry Ellipse radius y.
 * @param {number} phi Ellipse rotation, radians.
 * @param {number} largeArc Large-arc flag (0 or 1).
 * @param {number} sweep Sweep flag (0 or 1).
 * @param {number} x2 End point x.
 * @param {number} y2 End point y.
 * @param {!Array.<!Array.<number>>} points Vertex list to append to.
 * @private
 */
Blockly.BlockSvg.arcToPolyline_ = function(x1, y1, rx, ry, phi, largeArc,
    sweep, x2, y2, points) {
  if (rx === 0 || ry === 0) {
    points.push([x2, y2]);
    return;
  }
  var cosPhi = Math.cos(phi);
  var sinPhi = Math.sin(phi);
  var dx = (x1 - x2) / 2;
  var dy = (y1 - y2) / 2;
  var x1p = cosPhi * dx + sinPhi * dy;
  var y1p = -sinPhi * dx + cosPhi * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  var lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
  if (lambda > 1) {
    var radiusScale = Math.sqrt(lambda);
    rx *= radiusScale;
    ry *= radiusScale;
  }
  var sign = (largeArc !== sweep) ? 1 : -1;
  var num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  var den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  var co = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, num / den));
  var cxp = co * (rx * y1p / ry);
  var cyp = co * (-ry * x1p / rx);
  var centerX = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  var centerY = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  var ux = (x1p - cxp) / rx;
  var uy = (y1p - cyp) / ry;
  var vx = (-x1p - cxp) / rx;
  var vy = (-y1p - cyp) / ry;
  var startAngle = Math.atan2(uy, ux);
  var endAngle = Math.atan2(vy, vx);
  var delta = endAngle - startAngle;
  if (sweep && delta < 0) {
    delta += 2 * Math.PI;
  } else if (!sweep && delta > 0) {
    delta -= 2 * Math.PI;
  }
  var steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 18)));
  for (var s = 1; s <= steps; s++) {
    var angle = startAngle + delta * s / steps;
    points.push([
      centerX + rx * Math.cos(angle) * cosPhi -
          ry * Math.sin(angle) * sinPhi,
      centerY + rx * Math.cos(angle) * sinPhi +
          ry * Math.sin(angle) * cosPhi
    ]);
  }
};

/**
 * Whether an axis-aligned rectangle intersects a polygon. Correct for
 * concave polygons: they are separated exactly when no edge crosses and
 * neither contains a vertex of the other.
 * @param {number} rx Rectangle left edge.
 * @param {number} ry Rectangle top edge.
 * @param {number} rw Rectangle width.
 * @param {number} rh Rectangle height.
 * @param {!Array.<!Array.<number>>} poly Polygon vertices, path-local.
 * @param {number} dx Polygon x offset (block position, workspace units).
 * @param {number} dy Polygon y offset (block position, workspace units).
 * @return {boolean} True if the rectangle and polygon intersect.
 * @private
 */
Blockly.BlockSvg.rectIntersectsPolygon_ = function(rx, ry, rw, rh, poly, dx,
    dy) {
  var n = poly.length;
  if (n < 3) {
    return false;
  }
  var rLeft = rx;
  var rRight = rx + rw;
  var rTop = ry;
  var rBottom = ry + rh;
  var i;
  var px;
  var py;
  // 1. Any polygon vertex inside the rectangle?
  for (i = 0; i < n; i++) {
    px = poly[i][0] + dx;
    py = poly[i][1] + dy;
    if (px >= rLeft && px <= rRight && py >= rTop && py <= rBottom) {
      return true;
    }
  }
  // 2. Any rectangle corner inside the polygon?
  var corners = [[rLeft, rTop], [rRight, rTop], [rRight, rBottom],
      [rLeft, rBottom]];
  for (i = 0; i < 4; i++) {
    if (Blockly.BlockSvg.pointInPolygon_(corners[i][0], corners[i][1], poly,
        dx, dy)) {
      return true;
    }
  }
  // 3. Any polygon edge crossing a rectangle edge?
  var rectEdges = [[rLeft, rTop, rRight, rTop], [rRight, rTop, rRight, rBottom],
      [rRight, rBottom, rLeft, rBottom], [rLeft, rBottom, rLeft, rTop]];
  for (i = 0; i < n; i++) {
    var j = (i + 1) % n;
    var ax = poly[i][0] + dx;
    var ay = poly[i][1] + dy;
    var bx = poly[j][0] + dx;
    var by = poly[j][1] + dy;
    for (var e = 0; e < 4; e++) {
      if (Blockly.BlockSvg.segmentsIntersect_(ax, ay, bx, by,
          rectEdges[e][0], rectEdges[e][1], rectEdges[e][2],
          rectEdges[e][3])) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Whether a point lies inside a polygon (ray casting).
 * @param {number} px Point x, workspace units.
 * @param {number} py Point y, workspace units.
 * @param {!Array.<!Array.<number>>} poly Polygon vertices, path-local.
 * @param {number} dx Polygon x offset.
 * @param {number} dy Polygon y offset.
 * @return {boolean} True if the point is inside.
 * @private
 */
Blockly.BlockSvg.pointInPolygon_ = function(px, py, poly, dx, dy) {
  var inside = false;
  var n = poly.length;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var xi = poly[i][0] + dx;
    var yi = poly[i][1] + dy;
    var xj = poly[j][0] + dx;
    var yj = poly[j][1] + dy;
    if ((yi > py) !== (yj > py) &&
        px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * Whether line segment AB intersects line segment CD (strict crossing).
 * @return {boolean} True if the segments cross.
 * @private
 */
Blockly.BlockSvg.segmentsIntersect_ = function(ax, ay, bx, by, cx, cy, dx,
    dy) {
  var cross = function(ox, oy, px, py, qx, qy) {
    return (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  };
  var d1 = cross(cx, cy, dx, dy, ax, ay);
  var d2 = cross(cx, cy, dx, dy, bx, by);
  var d3 = cross(ax, ay, bx, by, cx, cy);
  var d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};

/**
 * Whether this block is a box-selectable unit. Text input shadows (the
 * rounded input boxes rendered behind text fields, whose HTML editor is the
 * .blocklyHtmlInput element) are NOT: they are input affordances rather than
 * blocks, so neither the rubber band nor the nested-content expansion
 * selects or highlights them. Dragging is unaffected: the group drag unit
 * still covers every descendant so an input box moves with its host.
 * @return {boolean} True if this block may be box-selected.
 */
Blockly.BlockSvg.prototype.isBoxSelectable = function() {
  return !(this.isShadow() && this.type === 'text');
};

/**
 * Turn the box-selection highlight on or off for this block. The highlight is
 * derived from the block's own primary colour and published as CSS custom
 * properties consumed by the .blocklyBoxSelected / .blocklyBoxFill rules in
 * css.js: the fill is a darkened version of the block's own fill, and the stroke
 * is a brighter tint of the same hue, so every selected block keeps its category
 * identity while reading as "pressed". Only the box selection
 * (Ctrl+drag rubber band / Ctrl+click, see core/gesture.js) uses this; plain
 * clicks, connection highlighting and block dragging keep the neutral
 * blocklySelected styling.
 * @param {boolean} on True to highlight, false to restore.
 */
Blockly.BlockSvg.prototype.setBoxSelectStyle = function(on, opt_strokeRgb,
    opt_fillRgb) {
  var svgRoot = this.svgGroup_;
  if (!svgRoot || !svgRoot.style) {
    return;
  }
  // Field boxes (number/text inputs and dropdowns) keep a border whose colour is
  // set inline on the <rect> by the field itself (e.g. a dropdown's
  // getColourTertiary() stroke, see core/field_dropdown.js). Overpainting it for
  // the highlight and then blindly removeAttribute('stroke') would erase that
  // original border for good, so we capture the field's own stroke on the first
  // paint and restore it exactly on clear. data-boxsel-orig stores the original
  // value; the empty string is the sentinel for "had no inline stroke".
  var paintFieldStroke = function(field, strokeHex) {
    if (!field.box_) {
      return;
    }
    // Capture the field's OWN stroke + width on first paint (2026-10-18): a
    // box-selected block with a field should outline that field at width 2, so we
    // record the original width and restore it exactly on clear. data-boxsel-orig
    // is the sentinel for "already captured".
    if (field.box_.getAttribute('data-boxsel-orig') === null) {
      var origStroke = field.box_.getAttribute('stroke');
      field.box_.setAttribute('data-boxsel-orig', origStroke === null ? '' : origStroke);
      var origWidth = field.box_.getAttribute('stroke-width');
      field.box_.setAttribute('data-boxsel-width-orig', origWidth === null ? '' : origWidth);
    }
    field.box_.setAttribute('stroke', strokeHex);
    field.box_.setAttribute('stroke-width', '2');
  };
  var clearFieldStroke = function(field) {
    if (!field.box_) {
      return;
    }
    var origStroke = field.box_.getAttribute('data-boxsel-orig');
    if (origStroke === null) {
      return;
    }
    if (origStroke === '') {
      field.box_.removeAttribute('stroke');
    } else {
      field.box_.setAttribute('stroke', origStroke);
    }
    var origWidth = field.box_.getAttribute('data-boxsel-width-orig');
    if (origWidth === null) {
      // Not captured — nothing to undo.
    } else if (origWidth === '') {
      field.box_.removeAttribute('stroke-width');
    } else {
      field.box_.setAttribute('stroke-width', origWidth);
    }
    field.box_.removeAttribute('data-boxsel-orig');
    field.box_.removeAttribute('data-boxsel-width-orig');
  };
  // An empty value input (e.g. the boolean CONDITION socket of an `if` block,
  // shown as a notch outline) renders an `input.outlinePath` whose fill is the
  // block's tertiary colour. When the holding block is box-selected, give that
  // empty socket the SAME outline + fill as the block so the whole selection
  // (including the gap where a block would plug in) reads as one highlighted
  // unit (user request 2026-10-18). Only actually-empty sockets are painted, and
  // the original stroke / fill are captured on first paint and restored on clear.
  var paintInputOutline = function(input, strokeHex, fillHex) {
    if (!input.outlinePath || !input.connection ||
        input.connection.targetConnection) {
      return;  // No outline, or the socket is filled.
    }
    if (input.outlinePath.getAttribute('data-boxsel-orig') === null) {
      var origStroke = input.outlinePath.getAttribute('stroke');
      input.outlinePath.setAttribute('data-boxsel-orig', origStroke === null ? '' : origStroke);
      var origFill = input.outlinePath.getAttribute('fill');
      input.outlinePath.setAttribute('data-boxsel-fill-orig', origFill === null ? '' : origFill);
    }
    if (strokeHex) {
      input.outlinePath.setAttribute('stroke', strokeHex);
      input.outlinePath.setAttribute('stroke-width', '2');
    }
    if (fillHex) {
      input.outlinePath.setAttribute('fill', fillHex);
    }
    // Tag it so the .blocklyBoxInputOutline CSS rule (.core/css.js) applies the
    // !important 2px border while selected.
    Blockly.utils.addClass(
        /** @type {!Element} */ (input.outlinePath), 'blocklyBoxInputOutline');
  };
  var clearInputOutline = function(input) {
    if (!input.outlinePath) {
      return;
    }
    var origStroke = input.outlinePath.getAttribute('data-boxsel-orig');
    if (origStroke === null) {
      return;
    }
    if (origStroke === '') {
      input.outlinePath.removeAttribute('stroke');
    } else {
      input.outlinePath.setAttribute('stroke', origStroke);
    }
    input.outlinePath.removeAttribute('stroke-width');
    var origFill = input.outlinePath.getAttribute('data-boxsel-fill-orig');
    if (origFill === '') {
      input.outlinePath.removeAttribute('fill');
    } else if (origFill !== null) {
      input.outlinePath.setAttribute('fill', origFill);
    }
    input.outlinePath.removeAttribute('data-boxsel-orig');
    input.outlinePath.removeAttribute('data-boxsel-fill-orig');
    Blockly.utils.removeClass(
        /** @type {!Element} */ (input.outlinePath), 'blocklyBoxInputOutline');
  };
  if (!on) {
    Blockly.utils.removeClass(
        /** @type {!Element} */ (svgRoot), 'blocklyBoxSelected');
    Blockly.utils.removeClass(
        /** @type {!Element} */ (svgRoot), 'blocklyBoxFill');
    svgRoot.style.removeProperty('--blockly-select-fill');
    svgRoot.style.removeProperty('--blockly-select-stroke');
    // Drop any field-box stroke painted while selected, restoring the field's
    // own original border (a dropdown's colourTertiary stroke, etc.).
    for (var bi = 0; bi < this.inputList.length; bi++) {
      var fieldRow = this.inputList[bi].fieldRow;
      for (var bj = 0; bj < fieldRow.length; bj++) {
        clearFieldStroke(fieldRow[bj]);
      }
      // Also drop any empty-input outline (e.g. an `if` block's empty boolean
      // socket) painted while selected.
      clearInputOutline(this.inputList[bi]);
    }
    return;
  }
  Blockly.utils.addClass(
      /** @type {!Element} */ (svgRoot), 'blocklyBoxSelected');
  if (!this.colour_) {
    return;
  }
  var rgb = goog.color.hexToRgb(this.colour_);
  // A brighter tint of the same hue reads as a highlight on mid/dark blocks,
  // but white (text input shadows, custom white blocks) lightened is still
  // white: darken those instead so every selected block keeps a visible
  // outline.
  var luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  var strokeRgb = opt_strokeRgb || (luma > 200 ? goog.color.darken(rgb, 0.3) :
      goog.color.lighten(rgb, 0.4));
  var strokeHex = goog.color.rgbArrayToHex(strokeRgb);
  svgRoot.style.setProperty('--blockly-select-stroke', strokeHex);
  // The highlight FILL colour for this block (null when it opts out, e.g. very
  // light blocks). Mirrors the logic in the fill section below, computed up front
  // so the empty-input outlines can share it.
  var fillHex = null;
  if (typeof opt_fillRgb !== 'undefined' && opt_fillRgb !== null) {
    fillHex = goog.color.rgbArrayToHex(opt_fillRgb);
  } else if (typeof opt_fillRgb === 'undefined' && luma <= 200) {
    fillHex = goog.color.rgbArrayToHex(goog.color.darken(rgb, 0.2));
  }
  // Outline editable field boxes (the number / text input <rect> created in
  // core/field_textinput.js) with the same colour, so a value-input child's
  // field border follows the block that holds it instead of staying the default
  // grey. Only this block's own fields are touched — nested blocks' fields belong
  // to their own selections, so there is no cross-block colour leak.
  for (var bi = 0; bi < this.inputList.length; bi++) {
    var fieldRow = this.inputList[bi].fieldRow;
    for (var bj = 0; bj < fieldRow.length; bj++) {
      paintFieldStroke(fieldRow[bj], strokeHex);
    }
    // Give this block's empty value inputs (an `if` block's empty boolean
    // socket, etc.) the same outline + fill as the block itself, so the whole
    // selection — including the gap where a block would plug in — highlights as
    // one unit (2026-10-18).
    paintInputOutline(this.inputList[bi], strokeHex, fillHex);
  }
  // Fill highlight: a directly-hit block darkens its OWN fill so it reads as
  // selected while keeping its category colour. C / loop headers are now included
  // — their path frames the body as a hole, so the darkened fill only tints the
  // frame and never covers the still-unselected blocks nested inside (2026-10-18).
  // Very light blocks (luma > 200: white input shadows, custom-white blocks) opt
  // out: darkening white reads as grey, not a tint of the block's own colour, so
  // they keep their original fill and rely on the outline alone. This also kills
  // the intermittent grey fill seen on input shadows while dragging a rubber band
  // (a white block momentarily hit on its own would otherwise be filled grey and
  // then kept grey once it becomes a nested child of a later-hit block).
  // A nested child (value-input reporter or C-block body block) passes
  // opt_fillRgb === null ("outline only") so it keeps its OWN fill and never
  // borrows the container's — see WorkspaceSvg.setBoxSelection /
  // getBoxSelectColors_ and the 2026-10-18 report.
  if (typeof opt_fillRgb !== 'undefined') {
    if (opt_fillRgb === null) {
      Blockly.utils.removeClass(
          /** @type {!Element} */ (svgRoot), 'blocklyBoxFill');
      svgRoot.style.removeProperty('--blockly-select-fill');
    } else {
      Blockly.utils.addClass(
          /** @type {!Element} */ (svgRoot), 'blocklyBoxFill');
      svgRoot.style.setProperty('--blockly-select-fill',
          goog.color.rgbArrayToHex(opt_fillRgb));
    }
  } else if (luma > 200) {
    Blockly.utils.removeClass(
        /** @type {!Element} */ (svgRoot), 'blocklyBoxFill');
    svgRoot.style.removeProperty('--blockly-select-fill');
  } else {
    Blockly.utils.addClass(
        /** @type {!Element} */ (svgRoot), 'blocklyBoxFill');
    svgRoot.style.setProperty('--blockly-select-fill',
        goog.color.rgbArrayToHex(goog.color.darken(rgb, 0.2)));
  }
};

/**
 * Update the cursor over this block by adding or removing a class.
 * @param {boolean} letMouseThrough True if the blocks should ignore pointer
 *     events, false otherwise.
 * @package
 */
Blockly.BlockSvg.prototype.setMouseThroughStyle = function(letMouseThrough) {
  if (letMouseThrough) {
    Blockly.utils.addClass(/** @type {!Element} */ (this.svgGroup_),
        'blocklyDraggingMouseThrough');
  } else {
    Blockly.utils.removeClass(/** @type {!Element} */ (this.svgGroup_),
        'blocklyDraggingMouseThrough');
  }
};

/**
 * Update the cursor over this block by adding or removing a class.
 * @param {boolean} enable True if the delete cursor should be shown, false
 *     otherwise.
 * @package
 */
Blockly.BlockSvg.prototype.setDeleteStyle = function(enable) {
  if (enable) {
    Blockly.utils.addClass(/** @type {!Element} */ (this.svgGroup_),
        'blocklyDraggingDelete');
  } else {
    Blockly.utils.removeClass(/** @type {!Element} */ (this.svgGroup_),
        'blocklyDraggingDelete');
  }
};

// Overrides of functions on Blockly.Block that take into account whether the
// block has been rendered.

/**
 * Change the colour of a block.
 * @param {number|string} colour HSV hue value, or #RRGGBB string.
 * @param {number|string} colourSecondary Secondary HSV hue value, or #RRGGBB
 *    string.
 * @param {number|string} colourTertiary Tertiary HSV hue value, or #RRGGBB
 *    string.
 * @param {number|string} colourQuaternary Quaternary HSV hue value, or #RRGGBB
 *    string.
 */
Blockly.BlockSvg.prototype.setColour = function(colour, colourSecondary,
    colourTertiary, colourQuaternary) {
  Blockly.BlockSvg.superClass_.setColour.call(this, colour, colourSecondary,
      colourTertiary, colourQuaternary);

  if (this.rendered) {
    this.updateColour();
  }
};

/**
 * Move this block to the front of the visible workspace.
 * <g> tags do not respect z-index so SVG renders them in the
 * order that they are in the DOM.  By placing this block first within the
 * block group's <g>, it will render on top of any other blocks.
 * @package
 */
Blockly.BlockSvg.prototype.bringToFront = function() {
  // PATCH 16 (2026-10-11): move the stack's root <g> once instead of walking
  // every ancestor. A stack is a single DOM subtree, so one appendChild gives
  // the same z-order; the old loop issued one sibling reorder per block between
  // the clicked block and the stack root, and every reorder invalidated
  // style+layout for the whole SVG (measured, 8 field clicks on a 400-block
  // stack: 621ms -> 249ms, worst frame 63.9ms -> 21.9ms). Doing nothing when the
  // stack is already last keeps repeated clicks free.
  var rootBlock = this.getRootBlock();
  var svgRoot = rootBlock.getSvgRoot();
  if (!svgRoot) {
    return;
  }
  var parent = svgRoot.parentNode;
  if (parent && parent.lastElementChild !== svgRoot) {
    parent.appendChild(svgRoot);
  }
};

/**
 * Set whether this block can chain onto the bottom of another block.
 * @param {boolean} newBoolean True if there can be a previous statement.
 * @param {(string|Array.<string>|null)=} opt_check Statement type or
 *     list of statement types.  Null/undefined if any type could be connected.
 */
Blockly.BlockSvg.prototype.setPreviousStatement = function(newBoolean,
    opt_check) {
  Blockly.BlockSvg.superClass_.setPreviousStatement.call(this, newBoolean,
      opt_check);

  if (this.rendered) {
    this.render();
    this.bumpNeighbours_();
  }
};

/**
 * Set whether another block can chain onto the bottom of this block.
 * @param {boolean} newBoolean True if there can be a next statement.
 * @param {(string|Array.<string>|null)=} opt_check Statement type or
 *     list of statement types.  Null/undefined if any type could be connected.
 */
Blockly.BlockSvg.prototype.setNextStatement = function(newBoolean, opt_check) {
  Blockly.BlockSvg.superClass_.setNextStatement.call(this, newBoolean,
      opt_check);

  if (this.rendered) {
    this.render();
    this.bumpNeighbours_();
  }
};

/**
 * Set whether this block returns a value.
 * @param {boolean} newBoolean True if there is an output.
 * @param {(string|Array.<string>|null)=} opt_check Returned type or list
 *     of returned types.  Null or undefined if any type could be returned
 *     (e.g. variable get).
 */
Blockly.BlockSvg.prototype.setOutput = function(newBoolean, opt_check) {
  Blockly.BlockSvg.superClass_.setOutput.call(this, newBoolean, opt_check);

  if (this.rendered) {
    this.render();
    this.bumpNeighbours_();
  }
};

/**
 * Set whether value inputs are arranged horizontally or vertically.
 * @param {boolean} newBoolean True if inputs are horizontal.
 */
Blockly.BlockSvg.prototype.setInputsInline = function(newBoolean) {
  Blockly.BlockSvg.superClass_.setInputsInline.call(this, newBoolean);

  if (this.rendered) {
    this.render();
    this.bumpNeighbours_();
  }
};

/**
 * Remove an input from this block.
 * @param {string} name The name of the input.
 * @param {boolean=} opt_quiet True to prevent error if input is not present.
 * @throws {goog.asserts.AssertionError} if the input is not present and
 *     opt_quiet is not true.
 */
Blockly.BlockSvg.prototype.removeInput = function(name, opt_quiet) {
  Blockly.BlockSvg.superClass_.removeInput.call(this, name, opt_quiet);

  if (this.rendered) {
    this.render();
    // Removing an input will cause the block to change shape.
    this.bumpNeighbours_();
  }
};

/**
 * Move a numbered input to a different location on this block.
 * @param {number} inputIndex Index of the input to move.
 * @param {number} refIndex Index of input that should be after the moved input.
 */
Blockly.BlockSvg.prototype.moveNumberedInputBefore = function(
    inputIndex, refIndex) {
  Blockly.BlockSvg.superClass_.moveNumberedInputBefore.call(this, inputIndex,
      refIndex);

  if (this.rendered) {
    this.render();
    // Moving an input will cause the block to change shape.
    this.bumpNeighbours_();
  }
};

/**
 * Add a value input, statement input or local variable to this block.
 * @param {number} type Either Blockly.INPUT_VALUE or Blockly.NEXT_STATEMENT or
 *     Blockly.DUMMY_INPUT.
 * @param {string} name Language-neutral identifier which may used to find this
 *     input again.  Should be unique to this block.
 * @return {!Blockly.Input} The input object created.
 * @private
 */
Blockly.BlockSvg.prototype.appendInput_ = function(type, name) {
  var input = Blockly.BlockSvg.superClass_.appendInput_.call(this, type, name);

  if (this.rendered) {
    this.render();
    // Adding an input will cause the block to change shape.
    this.bumpNeighbours_();
  }
  return input;
};

/**
 * Returns connections originating from this block.
 * @param {boolean} all If true, return all connections even hidden ones.
 *     Otherwise, for a non-rendered block return an empty list, and for a
 *     collapsed block don't return inputs connections.
 * @return {!Array.<!Blockly.Connection>} Array of connections.
 * @package
 */
Blockly.BlockSvg.prototype.getConnections_ = function(all) {
  var myConnections = [];
  if (all || this.rendered) {
    if (this.outputConnection) {
      myConnections.push(this.outputConnection);
    }
    if (this.previousConnection) {
      myConnections.push(this.previousConnection);
    }
    if (this.nextConnection) {
      myConnections.push(this.nextConnection);
    }
    if (all || !this.collapsed_) {
      for (var i = 0, input; input = this.inputList[i]; i++) {
        if (input.connection) {
          myConnections.push(input.connection);
        }
      }
    }
  }
  return myConnections;
};

/**
 * Create a connection of the specified type.
 * @param {number} type The type of the connection to create.
 * @return {!Blockly.RenderedConnection} A new connection of the specified type.
 * @private
 */
Blockly.BlockSvg.prototype.makeConnection_ = function(type) {
  return new Blockly.RenderedConnection(this, type);
};

/**
 * Bump unconnected blocks out of alignment.  Two blocks which aren't actually
 * connected should not coincidentally line up on screen.
 * @private
 */
Blockly.BlockSvg.prototype.bumpNeighbours_ = function() {
  if (!this.workspace) {
    return;  // Deleted block.
  }
  if (this.workspace.isDragging()) {
    return;  // Don't bump blocks during a drag.
  }
  var rootBlock = this.getRootBlock();
  if (rootBlock.isInFlyout) {
    return;  // Don't move blocks around in a flyout.
  }
  // Loop through every connection on this block.
  var myConnections = this.getConnections_(false);
  for (var i = 0, connection; connection = myConnections[i]; i++) {

    // Spider down from this block bumping all sub-blocks.
    if (connection.isConnected() && connection.isSuperior()) {
      connection.targetBlock().bumpNeighbours_();
    }

    var neighbours = connection.neighbours_(Blockly.SNAP_RADIUS);
    for (var j = 0, otherConnection; otherConnection = neighbours[j]; j++) {

      // If both connections are connected, that's probably fine.  But if
      // either one of them is unconnected, then there could be confusion.
      if (!connection.isConnected() || !otherConnection.isConnected()) {
        // Only bump blocks if they are from different tree structures.
        if (otherConnection.getSourceBlock().getRootBlock() != rootBlock) {

          // Always bump the inferior block.
          if (connection.isSuperior()) {
            otherConnection.bumpAwayFrom_(connection);
          } else {
            connection.bumpAwayFrom_(otherConnection);
          }
        }
      }
    }
  }
};

/**
 * Schedule snapping to grid and bumping neighbours to occur after a brief
 * delay.
 * @package
 */
Blockly.BlockSvg.prototype.scheduleSnapAndBump = function() {
  var block = this;
  // Ensure that any snap and bump are part of this move's event group.
  var group = Blockly.Events.getGroup();

  setTimeout(function() {
    Blockly.Events.setGroup(group);
    block.snapToGrid();
    Blockly.Events.setGroup(false);
  }, Blockly.BUMP_DELAY / 2);

  setTimeout(function() {
    Blockly.Events.setGroup(group);
    block.bumpNeighbours_();
    Blockly.Events.setGroup(false);
  }, Blockly.BUMP_DELAY);
};
