/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2018 Google Inc.
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
 * @fileoverview A frame: a labelled, resizable, collapsible box that visually
 * groups the scripts sitting inside it. Frames are drawn and behave like
 * workspace comments, and share their styling.
 */
'use strict';

goog.provide('Blockly.Frame');

goog.require('Blockly.BlockAnimations');
goog.require('Blockly.Events.FrameChange');
goog.require('Blockly.Events.FrameCreate');
goog.require('Blockly.Events.FrameDelete');
goog.require('Blockly.Events.FrameMove');
goog.require('Blockly.Colours');
goog.require('Blockly.DropDownDiv');
goog.require('Blockly.FieldColourSlider');
goog.require('Blockly.utils');

goog.require('goog.color');
goog.require('goog.dom');
goog.require('goog.events');
goog.require('goog.math.Coordinate');
goog.require('goog.style');
goog.require('goog.ui.Component');
goog.require('goog.ui.Slider');


/**
 * Class for a frame.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace to put the frame on.
 * @param {!Object} opt_options Options: id, title, x, y, width, height,
 *     collapsed.
 * @constructor
 */
Blockly.Frame = function(workspace, opt_options) {
  var options = opt_options || {};

  /** @type {!Blockly.WorkspaceSvg} */
  this.workspace = workspace;

  /** @type {string} */
  this.id = options.id && !workspace.getFrameById(options.id) ?
      options.id : Blockly.utils.genUid();

  /**
   * Marks this as a frame for the gesture and dragging code, which duck-types
   * the things it can drag.
   * @type {boolean}
   */
  this.isFrame = true;

  this.title_ = options.title || '';
  this.colour_ = /^#[0-9a-f]{6}$/i.test(options.colour) ?
      options.colour : Blockly.Frame.DEFAULT_COLOUR;
  this.collapsed_ = !!options.collapsed;
  this.locked_ = !!options.locked;

  /**
   * The blocks this frame swallowed when it was collapsed. Collapsing pulls
   * everything below the frame up into the space the frame used to occupy, so
   * while collapsed the frame can no longer work out which blocks are its own
   * from their positions alone, and has to remember them.
   * Only meaningful while collapsed_ is true.
   * @type {!Array.<string>}
   * @private
   */
  this.blockIds_ = options.blockIds || [];
  /** @type {?Set<string>} PATCH 26: lazy O(1) index over blockIds_. @private */
  this.blockIdSet_ = null;

  this.width_ = Math.max(options.width || Blockly.Frame.DEFAULT_WIDTH,
      Blockly.Frame.MIN_WIDTH);
  this.height_ = Math.max(options.height || Blockly.Frame.DEFAULT_HEIGHT,
      Blockly.Frame.MIN_HEIGHT);

  this.xy_ = new goog.math.Coordinate(options.x || 0, options.y || 0);

  /**
   * Blocks moving with this frame during a drag, and the move events recording
   * where they started. Null when not dragging.
   * @private
   */
  this.dragMembers_ = null;
  this.dragMemberEvents_ = null;
  this.lastDragXY_ = null;

  /** @type {?Element} @private */
  this.dragSurface_ = null;
  /** @type {?Element} @private */
  this.dragSurfaceLayer_ = null;
  /** @type {?Array.<!Element>} @private */
  this.dragSurfaceRoots_ = null;

  this.rendered_ = false;

  this.createDom_();
  this.workspace.addTopFrame(this);
  this.invalidateBounds_();

  this.render();
  this.translate(this.xy_.x, this.xy_.y);
};

/** Default width of a new frame, in workspace units. */
Blockly.Frame.DEFAULT_WIDTH = 320;

/** Default height of a new frame, in workspace units. */
Blockly.Frame.DEFAULT_HEIGHT = 200;

/** Minimum width of a frame, in workspace units. Fits the title bar icons. */
Blockly.Frame.MIN_WIDTH = 100;

/** Minimum height of a frame, in workspace units. */
Blockly.Frame.MIN_HEIGHT = 54;

/** Height of the title bar, and of the whole frame when collapsed. */
Blockly.Frame.TOP_BAR_HEIGHT = 32;

/** Size of the square corner resize handle. */
Blockly.Frame.RESIZE_SIZE = 16;

/** Size of the icons in the title bar. */
Blockly.Frame.ICON_SIZE = 32;

/** Corner radius of the frame, matching a workspace comment. */
Blockly.Frame.BORDER_RADIUS = 4;

/** Gap left around the blocks inside a frame when it grows to fit them. */
Blockly.Frame.PADDING = 16;

/** Default frame fill, matching a workspace comment. */
Blockly.Frame.DEFAULT_COLOUR = '#fef49c';

/**
 * Create the frame's DOM, and put it behind every block on the workspace.
 * @private
 */
Blockly.Frame.prototype.createDom_ = function() {
  this.svgGroup_ = Blockly.utils.createSvgElement('g',
      {'class': 'blocklyFrame'}, null);

  this.svgRect_ = Blockly.utils.createSvgElement('rect',
      {
        'class': 'scratchCommentRect scratchWorkspaceCommentBorder',
        'x': 0,
        'y': 0,
        'rx': Blockly.Frame.BORDER_RADIUS,
        'ry': Blockly.Frame.BORDER_RADIUS
      },
      this.svgGroup_);

  this.svgTopBar_ = Blockly.utils.createSvgElement('rect',
      {
        'class': 'blocklyDraggable scratchCommentTopBar',
        'x': 0,
        'y': 0,
        'rx': 1,
        'ry': 1,
        'height': Blockly.Frame.TOP_BAR_HEIGHT
      },
      this.svgGroup_);

  this.collapseIcon_ = this.createIcon_();
  this.deleteIcon_ = this.createIcon_();
  this.lockIcon_ = this.createIcon_();
  this.setIconImage_(this.deleteIcon_, 'delete-x.svg');

  // The title is plain text so that the whole title bar stays draggable.
  // Double-clicking it, or the Rename context menu item, swaps in the input
  // below.
  this.titleText_ = Blockly.utils.createSvgElement('text',
      {
        'class': 'scratchCommentText blocklyFrameTitle',
        'x': Blockly.Frame.ICON_SIZE,
        'y': Blockly.Frame.TOP_BAR_HEIGHT / 2,
        'dominant-baseline': 'central'
      },
      this.svgGroup_);

  this.foreignObject_ = Blockly.utils.createSvgElement('foreignObject',
      {
        'class': 'blocklyFrameForeignObject',
        'x': Blockly.Frame.ICON_SIZE,
        'y': 0,
        'height': Blockly.Frame.TOP_BAR_HEIGHT,
        'display': 'none'
      },
      this.svgGroup_);
  var body = document.createElementNS(Blockly.HTML_NS, 'body');
  body.setAttribute('xmlns', Blockly.HTML_NS);
  body.className = 'blocklyMinimalBody';
  this.titleInput_ = document.createElementNS(Blockly.HTML_NS, 'input');
  this.titleInput_.className = 'blocklyFrameTitleInput scratchCommentText';
  this.titleInput_.setAttribute('dir', this.workspace.RTL ? 'RTL' : 'LTR');
  this.titleInput_.setAttribute('placeholder', Blockly.Msg.FRAME_DEFAULT_TITLE);
  body.appendChild(this.titleInput_);
  this.foreignObject_.appendChild(body);

  this.setTitleText_();
  this.applyColour_();

  this.resizeGroup_ = Blockly.utils.createSvgElement('g',
      {
        'class': this.workspace.RTL ?
            'scratchCommentResizeSW' : 'scratchCommentResizeSE'
      },
      this.svgGroup_);
  var resizeSize = Blockly.Frame.RESIZE_SIZE;
  Blockly.utils.createSvgElement('polygon',
      {'points': [0, resizeSize, resizeSize, resizeSize, resizeSize, 0].join(' ')},
      this.resizeGroup_);
  Blockly.utils.createSvgElement('line',
      {
        'class': 'blocklyResizeLine',
        'x1': resizeSize / 3, 'y1': resizeSize - 1,
        'x2': resizeSize - 1, 'y2': resizeSize / 3
      }, this.resizeGroup_);
  Blockly.utils.createSvgElement('line',
      {
        'class': 'blocklyResizeLine',
        'x1': resizeSize * 2 / 3, 'y1': resizeSize - 1,
        'x2': resizeSize - 1, 'y2': resizeSize * 2 / 3
      }, this.resizeGroup_);

  this.bringToFront();
};

/**
 * Move the frame in front of the other frames, but keep it behind every block.
 * Frames share the block canvas with the blocks and <g> tags have no z-index,
 * so this is a reorder of the canvas' children: all the frames sit at the
 * front of it, in stacking order, followed by the blocks.
 * @package
 */
Blockly.Frame.prototype.bringToFront = function() {
  var canvas = this.workspace.getCanvas();
  // Viewport culling leaves comment nodes in the canvas as anchors for
  // unloaded stacks. They are not elements, so hasClass() cannot inspect them.
  var children = canvas.children;
  var firstBlock = null;
  for (var i = 0; i < children.length; i++) {
    if (!Blockly.utils.hasClass(children[i], 'blocklyFrame')) {
      firstBlock = children[i];
      break;
    }
  }
  // With no element children (every stack unloaded), keep the frame ahead of
  // the anchors too, so a restored stack never paints behind it.
  var reference = firstBlock || canvas.firstChild;
  if (reference !== this.svgGroup_) {
    canvas.insertBefore(this.svgGroup_, reference);
  }
};

/**
 * Add one of the title bar icons, using the same media as a workspace comment.
 * Both icons start on the left; setSize moves the delete icon over to the
 * right edge.
 * @return {!SVGElement} The icon's image element.
 * @private
 */
Blockly.Frame.prototype.createIcon_ = function() {
  return Blockly.utils.createSvgElement('image',
      {
        'class': 'blocklyFrameIcon',
        'x': 0,
        'y': (Blockly.Frame.TOP_BAR_HEIGHT - Blockly.Frame.ICON_SIZE) / 2,
        'width': Blockly.Frame.ICON_SIZE,
        'height': Blockly.Frame.ICON_SIZE
      },
      this.svgGroup_);
};

/**
 * Point a title bar icon at one of the media images.
 * @param {!SVGElement} icon The icon's image element.
 * @param {string} image The file name of the image, inside the media folder.
 * @private
 */
Blockly.Frame.prototype.setIconImage_ = function(icon, image) {
  icon.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href',
      this.workspace.options.pathToMedia + image);
};

/**
 * Show the frame's title, falling back to the placeholder when it has none.
 * @private
 */
Blockly.Frame.prototype.setTitleText_ = function() {
  this.titleText_.textContent = this.title_ || Blockly.Msg.FRAME_DEFAULT_TITLE;
  this.titleText_.setAttribute('fill-opacity', this.title_ ? 1 : 0.6);
};

/**
 * Turn the title into a text box so it can be typed into. The title is normally
 * plain text, so that dragging anywhere along the title bar moves the frame
 * instead of putting a cursor in a text box.
 * @package
 */
Blockly.Frame.prototype.startEditingTitle = function() {
  if (this.locked_) {
    return;
  }
  this.titleText_.setAttribute('display', 'none');
  this.foreignObject_.setAttribute('display', '');
  this.titleInput_.value = this.title_;
  this.titleInput_.focus();
  this.titleInput_.select();
};

/**
 * Put the title back to plain text, keeping whatever was typed.
 * @private
 */
Blockly.Frame.prototype.stopEditingTitle_ = function() {
  if (this.foreignObject_.getAttribute('display') == 'none') {
    return;
  }
  this.setTitle(this.titleInput_.value);
  this.foreignObject_.setAttribute('display', 'none');
  this.titleText_.setAttribute('display', '');
};

/**
 * Swap the collapse arrow between its open and closed images, the same way a
 * workspace comment does when it is minimized.
 * @private
 */
Blockly.Frame.prototype.updateCollapseIcon_ = function() {
  this.setIconImage_(this.collapseIcon_, this.collapsed_ ?
      'comment-arrow-up.svg' : 'comment-arrow-down.svg');
};

/**
 * Swap the lock icon between its locked and unlocked images.
 * @private
 */
Blockly.Frame.prototype.updateLockIcon_ = function() {
  this.setIconImage_(this.lockIcon_,
      this.locked_ ? 'locked.svg' : 'unlocked.svg');
  // Fade the two icons a locked frame no longer responds to.
  var opacity = this.locked_ ? 0.35 : 1;
  this.collapseIcon_.setAttribute('opacity', opacity);
  this.deleteIcon_.setAttribute('opacity', opacity);
};

/**
 * Bind the frame's event handlers and draw it for the first time.
 * @package
 */
Blockly.Frame.prototype.render = function() {
  if (this.rendered_) {
    return;
  }
  this.rendered_ = true;

  if (!this.workspace.options.readOnly) {
    Blockly.bindEventWithChecks_(
        this.svgTopBar_, 'mousedown', this, this.pathMouseDown_);
    Blockly.bindEventWithChecks_(
        this.svgRect_, 'mousedown', this, this.pathMouseDown_);
    Blockly.bindEventWithChecks_(
        this.resizeGroup_, 'mousedown', this, this.resizeMouseDown_);

    Blockly.bindEventWithChecks_(
        this.collapseIcon_, 'mousedown', this, this.iconMouseDown_, true);
    Blockly.bindEventWithChecks_(
        this.collapseIcon_, 'mouseout', this, this.iconMouseOut_, true);
    Blockly.bindEventWithChecks_(
        this.collapseIcon_, 'mouseup', this, this.collapseMouseUp_, true);
    Blockly.bindEventWithChecks_(
        this.deleteIcon_, 'mousedown', this, this.iconMouseDown_, true);
    Blockly.bindEventWithChecks_(
        this.deleteIcon_, 'mouseout', this, this.iconMouseOut_, true);
    Blockly.bindEventWithChecks_(
        this.deleteIcon_, 'mouseup', this, this.deleteMouseUp_, true);
    Blockly.bindEventWithChecks_(
        this.lockIcon_, 'mousedown', this, this.iconMouseDown_, true);
    Blockly.bindEventWithChecks_(
        this.lockIcon_, 'mouseout', this, this.iconMouseOut_, true);
    Blockly.bindEventWithChecks_(
        this.lockIcon_, 'mouseup', this, this.lockMouseUp_, true);

    // Double-clicking the title bar renames the frame. A single click has to
    // stay free to drag it.
    Blockly.bindEventWithChecks_(
        this.svgTopBar_, 'dblclick', this, this.titleDoubleClick_);

    // While the title is being typed into, the input owns the mouse.
    Blockly.bindEventWithChecks_(this.titleInput_, 'mousedown', this,
        function(e) {
          e.stopPropagation();
        }, true, true);
    Blockly.bindEventWithChecks_(
        this.titleInput_, 'blur', this, this.stopEditingTitle_);
    Blockly.bindEventWithChecks_(this.titleInput_, 'keydown', this,
        function(e) {
          if (e.keyCode == 13 || e.keyCode == 27) {
            if (e.keyCode == 27) {
              this.titleInput_.value = this.title_;
            }
            this.stopEditingTitle_();
          }
          e.stopPropagation();
        });
  }

  this.updateCollapseIcon_();
  this.updateLockIcon_();
  this.setSize(this.width_, this.height_);
  if (this.collapsed_) {
    // The blocks this frame swallowed may not have been created yet, so
    // Blockly.Frame.onWorkspaceChange hides them as they arrive.
    this.setMembersVisible_(false);
  }
};

/**
 * Start renaming the frame when its title bar is double-clicked.
 * @param {!Event} e Double click event.
 * @private
 */
Blockly.Frame.prototype.titleDoubleClick_ = function(e) {
  this.startEditingTitle();
  e.stopPropagation();
};

/**
 * Lay the frame out at its current size.
 * @param {number} width Width of the frame when expanded.
 * @param {number} height Height of the frame when expanded.
 * @package
 */
Blockly.Frame.prototype.setSize = function(width, height) {
  width = Math.max(width, Blockly.Frame.MIN_WIDTH);
  height = Math.max(height, Blockly.Frame.MIN_HEIGHT);
  this.width_ = width;
  this.height_ = height;

  var drawnHeight = this.collapsed_ ? Blockly.Frame.TOP_BAR_HEIGHT : height;

  this.svgRect_.setAttribute('width', width);
  this.svgRect_.setAttribute('height', drawnHeight);
  this.svgTopBar_.setAttribute('width', width);

  var iconSize = Blockly.Frame.ICON_SIZE;
  // The right-hand icons are the only things that have to be repositioned
  // whenever the frame's width changes. The lock sits just left of the delete.
  this.deleteIcon_.setAttribute('x', width - iconSize);
  // Nudge the lock towards the close button so the two glyphs read as a pair.
  this.lockIcon_.setAttribute('x', width - (2 * iconSize) + 8);

  this.foreignObject_.setAttribute('width',
      Math.max(0, width - (3 * iconSize)));

  this.resizeGroup_.setAttribute('transform', 'translate(' +
      (width - Blockly.Frame.RESIZE_SIZE) + ',' +
      (drawnHeight - Blockly.Frame.RESIZE_SIZE) + ')');
  this.resizeGroup_.setAttribute('display',
      this.collapsed_ || this.locked_ ? 'none' : '');
  this.invalidateBounds_();
};

/**
 * @return {string} The frame's title.
 * @package
 */
Blockly.Frame.prototype.getTitle = function() {
  return this.title_;
};

/**
 * Set the frame's title.
 * @param {string} title The new title.
 * @package
 */
Blockly.Frame.prototype.setTitle = function(title) {
  if (this.title_ == title) {
    return;
  }
  Blockly.Events.fire(new Blockly.Events.FrameChange(
      this, {title: this.title_}, {title: title}));
  this.title_ = title;
  this.setTitleText_();
};

/**
 * @return {string} The frame's fill, in '#rrggbb' format.
 * @package
 */
Blockly.Frame.prototype.getColour = function() {
  return this.colour_;
};

/**
 * Set the frame's fill.
 * @param {string} colour The new colour, in '#rrggbb' format.
 * @param {boolean=} opt_silent True to skip the change event while previewing.
 * @package
 */
Blockly.Frame.prototype.setColour = function(colour, opt_silent) {
  if (!/^#[0-9a-f]{6}$/i.test(colour) || this.colour_ == colour) {
    return;
  }
  if (!opt_silent) {
    Blockly.Events.fire(new Blockly.Events.FrameChange(
        this, {colour: this.colour_}, {colour: colour}));
  }
  this.colour_ = colour;
  this.applyColour_();
};

/**
 * Paint the rect, its border and the title with the current colour.
 * @private
 */
Blockly.Frame.prototype.applyColour_ = function() {
  if (!this.svgRect_) {
    return;
  }
  var rgb = goog.color.hexToRgb(this.colour_);
  var border = goog.color.rgbToHex(
      Math.round(rgb[0] * 0.68), Math.round(rgb[1] * 0.68),
      Math.round(rgb[2] * 0.68));
  this.svgRect_.style.fill = this.colour_;
  this.svgRect_.style.stroke = border;
  var luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  this.titleText_.setAttribute('fill', luminance < 128 ? '#ffffff' : '#000000');
};

/**
 * Open the built-in Scratch colour slider, anchored to the title bar. Live
 * changes are silent; a single change event is fired when the editor closes.
 * @private
 */
Blockly.Frame.prototype.showColourPicker_ = function() {
  var frame = this;
  var startColour = this.colour_;
  var field = new Blockly.FieldColourSlider(startColour);
  var hsv = goog.color.hexToHsv(startColour);
  field.hue_ = hsv[0];
  field.saturation_ = hsv[1];
  field.brightness_ = hsv[2];

  Blockly.DropDownDiv.hideWithoutAnimation();
  Blockly.DropDownDiv.clearContent();
  var div = Blockly.DropDownDiv.getContentDiv();

  var createSlider = function(channel, label, min, max, step, increment) {
    var parts = field.createLabelDom_(label);
    div.appendChild(parts[0]);
    var slider = new goog.ui.Slider();
    slider.setMoveToPointEnabled(true);
    slider.setMinimum(min);
    slider.setMaximum(max);
    if (step !== undefined) {
      slider.setStep(step);
    }
    if (increment !== undefined) {
      slider.setUnitIncrement(increment);
    }
    slider.render(div);
    return {slider: slider, readout: parts[1]};
  };

  var hue = createSlider('hue', Blockly.Msg.COLOUR_HUE_LABEL, 0, 360,
      undefined, 5);
  var saturation = createSlider('saturation',
      Blockly.Msg.COLOUR_SATURATION_LABEL, 0, 1, 0.001, 0.01);
  var brightness = createSlider('brightness',
      Blockly.Msg.COLOUR_BRIGHTNESS_LABEL, 0, 255, undefined, 2);

  var renderState = function() {
    hue.readout.textContent = Math.floor(100 * field.hue_ / 360).toFixed(0);
    saturation.readout.textContent =
        Math.floor(100 * field.saturation_).toFixed(0);
    brightness.readout.textContent =
        Math.floor(100 * field.brightness_ / 255).toFixed(0);
    field.setGradient_(hue.slider.getElement(), 'hue');
    field.setGradient_(saturation.slider.getElement(), 'saturation');
    field.setGradient_(brightness.slider.getElement(), 'brightness');
  };

  var update = function() {
    field.hue_ = hue.slider.getValue();
    field.saturation_ = saturation.slider.getValue();
    field.brightness_ = brightness.slider.getValue();
    frame.setColour(goog.color.hsvToHex(
        field.hue_, field.saturation_, field.brightness_), true);
    renderState();
  };

  var keys = [];

  var onHide = function() {
    for (var j = 0; j < keys.length; j++) {
      goog.events.unlistenByKey(keys[j]);
    }
    if (frame.svgGroup_ && frame.colour_ != startColour) {
      Blockly.Events.fire(new Blockly.Events.FrameChange(
          frame, {colour: startColour}, {colour: frame.colour_}));
    }
  };

  Blockly.DropDownDiv.setColour(
      Blockly.Colours.valueReportBackground, Blockly.Colours.valueReportBorder);
  Blockly.DropDownDiv.setBoundsElement(this.workspace.getParentSvg().parentNode);
  var rect = this.svgTopBar_.getBoundingClientRect();
  var x = rect.left + rect.width / 2;
  Blockly.DropDownDiv.show(this, x, rect.top + rect.height, x, rect.top,
      onHide);

  // FieldColourSlider.showEditor_ positions the thumbs only after the
  // drop-down is visible; before that the hidden slider has no usable layout.
  hue.slider.setValue(field.hue_);
  saturation.slider.setValue(field.saturation_);
  brightness.slider.setValue(field.brightness_);
  renderState();

  // Register the callbacks last, so the initial setValue() calls above cannot
  // be mistaken for user input and overwrite the captured HSV values.
  var items = [hue, saturation, brightness];
  for (var i = 0; i < items.length; i++) {
    keys.push(goog.events.listen(items[i].slider,
        goog.ui.Component.EventType.CHANGE, update));
  }
};

/**
 * @return {boolean} True if the frame is collapsed.
 * @package
 */
Blockly.Frame.prototype.isCollapsed = function() {
  return this.collapsed_;
};

/**
 * @return {boolean} True if the frame is locked.
 * @package
 */
Blockly.Frame.prototype.isLocked = function() {
  return this.locked_;
};

/**
 * Lock or unlock the frame. A locked frame ignores every edit except this one.
 * @param {boolean} locked Whether the frame should be locked.
 * @package
 */
Blockly.Frame.prototype.setLocked = function(locked) {
  locked = !!locked;
  if (this.locked_ == locked) {
    return;
  }
  Blockly.Events.fire(new Blockly.Events.FrameChange(
      this, {locked: this.locked_}, {locked: locked}));
  this.locked_ = locked;
  this.updateLockIcon_();
  this.setSize(this.width_, this.height_);
};

/**
 * @return {!Array.<string>} The ids of the blocks this frame swallowed when it
 *     was collapsed. Empty unless the frame is collapsed.
 * @package
 */
Blockly.Frame.prototype.getBlockIds = function() {
  return this.blockIds_;
};

/**
 * PATCH 26 (2026-11-07): O(1) membership test for a collapsed frame's ids.
 * Xml.restoreFrameVisibility_ calls this for every stack that becomes visible;
 * a linear indexOf made restoring a large workspace quadratic. The Set is
 * rebuilt lazily and only invalidated when blockIds_ is replaced.
 * @param {string} id Block id.
 * @return {boolean} Whether this frame swallowed that block.
 * @package
 */
Blockly.Frame.prototype.hasBlockId_ = function(id) {
  if (!this.blockIdSet_) {
    this.blockIdSet_ = new Set(this.blockIds_);
  }
  return this.blockIdSet_.has(id);
};

/**
 * @return {number} The frame's width when expanded.
 * @package
 */
Blockly.Frame.prototype.getWidth = function() {
  return this.width_;
};

/**
 * @return {number} The frame's height when expanded.
 * @package
 */
Blockly.Frame.prototype.getHeight = function() {
  return this.height_;
};

/**
 * @return {!goog.math.Coordinate} The frame's position in workspace units.
 * @package
 */
Blockly.Frame.prototype.getXY = function() {
  return new goog.math.Coordinate(this.xy_.x, this.xy_.y);
};

/**
 * The same as getXY. Frames never move to the drag surface, so their position
 * is always just their translation.
 * @return {!goog.math.Coordinate} The frame's position in workspace units.
 * @package
 */
Blockly.Frame.prototype.getRelativeToSurfaceXY = function() {
  return this.getXY();
};

/**
 * Return the frame's bounding box, so that it takes part in workspace sizing
 * alongside blocks and comments.
 * @return {!{topLeft: goog.math.Coordinate, bottomRight: goog.math.Coordinate}}
 *     The frame's corners, in workspace coordinates.
 * @package
 */
Blockly.Frame.prototype.getBoundingRectangle = function() {
  var height = this.collapsed_ ? Blockly.Frame.TOP_BAR_HEIGHT : this.height_;
  return {
    topLeft: new goog.math.Coordinate(this.xy_.x, this.xy_.y),
    bottomRight: new goog.math.Coordinate(
        this.xy_.x + this.width_, this.xy_.y + height)
  };
};

/**
 * @return {!SVGElement} The frame's SVG group.
 * @package
 */
Blockly.Frame.prototype.getSvgRoot = function() {
  return this.svgGroup_;
};

/**
 * Invalidate the workspace's cached content bounds when this frame's box
 * changes. No-op on workspaces without that cache.
 * @private
 */
Blockly.Frame.prototype.invalidateBounds_ = function() {
  if (this.workspace && this.workspace.invalidateContentBounds_) {
    this.workspace.invalidateContentBounds_(this);
  }
};

/**
 * Move the frame by a relative offset, taking any blocks inside it along.
 * @param {number} dx Horizontal offset, in workspace units.
 * @param {number} dy Vertical offset, in workspace units.
 * @package
 */
Blockly.Frame.prototype.moveBy = function(dx, dy) {
  if (this.locked_) {
    return;
  }
  var event = new Blockly.Events.FrameMove(this);
  this.translate(this.xy_.x + dx, this.xy_.y + dy);
  event.recordNew();
  Blockly.Events.fire(event);
  this.workspace.resizeContents();
};

/**
 * Set the frame's translation.
 * @param {number} x The x coordinate, in workspace units.
 * @param {number} y The y coordinate, in workspace units.
 * @package
 */
Blockly.Frame.prototype.translate = function(x, y) {
  this.xy_ = new goog.math.Coordinate(x, y);
  this.svgGroup_.setAttribute('transform', 'translate(' + x + ',' + y + ')');
  this.invalidateBounds_();
};

/**
 * Move the frame to an absolute position, taking any blocks inside it along.
 * @param {number} x The x coordinate, in workspace units.
 * @param {number} y The y coordinate, in workspace units.
 * @package
 */
Blockly.Frame.prototype.moveTo = function(x, y) {
  if (this.locked_) {
    return;
  }
  this.translate(x, y);
  this.dragMembersTo_(x, y);
};

/**
 * Move the frame during a drag. Frames stay on the block canvas so that they
 * keep painting behind the blocks, so there is never a drag surface to use.
 * @param {?Blockly.BlockDragSurfaceSvg} _dragSurface Unused.
 * @param {!goog.math.Coordinate} newLoc The new location, in workspace units.
 * @package
 */
Blockly.Frame.prototype.moveDuringDrag = function(_dragSurface, newLoc) {
  if (this.locked_) {
    return;
  }
  if (this.dragSurfaceLayer_) {
    var transform = this.workspace.getCanvas().getAttribute('transform');
    if (transform) {
      this.dragSurfaceLayer_.setAttribute('transform', transform);
    }
  }
  this.translate(newLoc.x, newLoc.y);
  this.dragMembersTo_(newLoc.x, newLoc.y);
};

/**
 * Drag the blocks inside the frame along with it. Called with the frame's
 * absolute position, and moves the members by however far the frame has moved
 * since last time, so that calling it twice with the same position is a no-op.
 * @param {number} x The frame's new x coordinate.
 * @param {number} y The frame's new y coordinate.
 * @private
 */
Blockly.Frame.prototype.dragMembersTo_ = function(x, y) {
  if (!this.dragMembers_ || !this.dragMembers_.length) {
    return;
  }
  var dx = x - this.lastDragXY_.x;
  var dy = y - this.lastDragXY_.y;
  if (!dx && !dy) {
    return;
  }
  var totalX = x - this.dragStartXY_.x;
  var totalY = y - this.dragStartXY_.y;
  this.lastDragXY_ = new goog.math.Coordinate(x, y);

  // Translate from the captured canvas coordinates instead of moveBy(), which
  // would call getRelativeToSurfaceXY() on a node outside the workspace SVG.
  // The blocks' move events were captured when the drag started and are fired
  // once when it ends, so keep the intermediate moves silent.
  Blockly.Events.disable();
  try {
    for (var i = 0; i < this.dragMembers_.length; i++) {
      var origin = this.dragMemberStarts_[i];
      this.dragMembers_[i].translate(origin.x + totalX, origin.y + totalY);
      this.dragMembers_[i].moveConnections_(dx, dy);
    }
  } finally {
    Blockly.Events.enable();
  }
};

/**
 * Add or remove the drag style, and snapshot the blocks that should travel
 * with the frame.
 * @param {boolean} adding True if the frame is being dragged.
 * @package
 */
Blockly.Frame.prototype.setDragging = function(adding) {
  if (adding && this.locked_) {
    return;
  }
  if (adding) {
    this.materializeForEdit_(false);
    this.bringToFront();
    this.dragMembers_ = this.getMembers();
    // Members ride a sibling SVG during the drag, where getRelativeToSurfaceXY()
    // cannot walk their DOM ancestry. Restore unloaded stacks and capture their
    // positions while they are still on the block canvas.
    for (var m = 0; m < this.dragMembers_.length; m++) {
      if (this.dragMembers_[m].intersects_ === false) {
        this.dragMembers_[m].setIntersects(true);
      }
    }
    this.dragMemberStarts_ = [];
    for (var k = 0; k < this.dragMembers_.length; k++) {
      this.dragMemberStarts_.push(
          this.dragMembers_[k].getRelativeToSurfaceXY());
    }
    this.dragStartXY_ = this.getXY();
    this.lastDragXY_ = this.dragStartXY_;
    this.dragMemberEvents_ = [];
    for (var i = 0; i < this.dragMembers_.length; i++) {
      // The move event's constructor records where the block started.
      this.dragMemberEvents_.push(
          new Blockly.Events.BlockMove(this.dragMembers_[i]));
    }
    Blockly.utils.addClass(this.svgGroup_, 'blocklyDragging');
    this.startDragSurface_();
  } else {
    this.stopDragSurface_();
    if (this.dragMemberEvents_) {
      for (var j = 0; j < this.dragMemberEvents_.length; j++) {
        var event = this.dragMemberEvents_[j];
        event.recordNew();
        Blockly.Events.fire(event);
      }
    }
    this.dragMembers_ = null;
    this.dragMemberEvents_ = null;
    this.dragMemberStarts_ = null;
    this.dragStartXY_ = null;
    this.lastDragXY_ = null;
    if (this.svgGroup_) {
      Blockly.utils.removeClass(this.svgGroup_, 'blocklyDragging');
    }
  }
};

/**
 * Lift the frame and its scripts onto a sibling SVG that paints above the
 * flyout (z-index 45). The flyout is a sibling of the workspace SVG, so a layer
 * inside the block canvas always renders below it.
 * @private
 */
Blockly.Frame.prototype.startDragSurface_ = function() {
  var workspace = this.workspace;
  var injectionDiv = workspace.getParentSvg().parentNode;
  var surface = Blockly.utils.createSvgElement('svg',
      {
        'xmlns': Blockly.SVG_NS,
        'version': '1.1',
        'class': 'blocklyFrameDragSurface'
      }, injectionDiv);
  var layer = Blockly.utils.createSvgElement('g', {}, surface);
  surface.style.display = 'block';
  var transform = workspace.getCanvas().getAttribute('transform');
  if (transform) {
    layer.setAttribute('transform', transform);
  }
  this.dragSurface_ = surface;
  this.dragSurfaceLayer_ = layer;

  var roots = [this.svgGroup_];
  for (var i = 0; i < this.dragMembers_.length; i++) {
    var block = this.dragMembers_[i];
    if (block.intersects_ === false) {
      block.setIntersects(true);
    }
    var root = block.getSvgRoot();
    if (root) {
      roots.push(root);
    }
  }
  this.dragSurfaceRoots_ = roots;
  for (var j = 0; j < roots.length; j++) {
    layer.appendChild(roots[j]);
  }
  workspace.frameDragActiveBlocks_ = new Set(this.dragMembers_);
};

/**
 * Put the frame and its scripts back on the block canvas.
 * @private
 */
Blockly.Frame.prototype.stopDragSurface_ = function() {
  if (!this.dragSurface_) {
    return;
  }
  var canvas = this.workspace.getCanvas();
  this.bringToFront();
  var roots = this.dragSurfaceRoots_ || [];
  for (var i = 1; i < roots.length; i++) {
    if (roots[i].parentNode !== canvas) {
      canvas.appendChild(roots[i]);
    }
  }
  goog.dom.removeNode(this.dragSurface_);
  this.dragSurface_ = null;
  this.dragSurfaceLayer_ = null;
  this.dragSurfaceRoots_ = null;
  this.workspace.frameDragActiveBlocks_ = null;
  this.workspace.resizeContents();
};

/**
 * @return {boolean} True. Frames can be dropped on the toolbox or the trash
 *     can to delete them, like blocks and comments. The scripts travelling
 *     with the frame go with it.
 * @package
 */
Blockly.Frame.prototype.isDeletable = function() {
  return !this.locked_;
};

/**
 * Update the cursor over the frame to show whether dropping it now would
 * delete it.
 * @param {boolean} enable True if the delete cursor should be shown.
 * @package
 */
Blockly.Frame.prototype.setDeleteStyle = function(enable) {
  if (enable) {
    Blockly.utils.addClass(this.svgGroup_, 'blocklyDraggingDelete');
  } else {
    Blockly.utils.removeClass(this.svgGroup_, 'blocklyDraggingDelete');
  }
};

/**
 * No-op, for compatibility with the bubble dragger.
 * @package
 */
Blockly.Frame.prototype.setAutoLayout = function() {
};

/**
 * @return {boolean} True. Frames can always be dragged.
 * @package
 */
Blockly.Frame.prototype.isMovable = function() {
  return !this.locked_;
};

/**
 * Handle a mouse-down on the frame's body or title bar: start a drag.
 * @param {!Event} e Mouse down event.
 * @private
 */
Blockly.Frame.prototype.pathMouseDown_ = function(e) {
  var gesture = this.workspace.getGesture(e);
  // Ctrl/Cmd+drag belongs to the workspace gesture: letting the event bubble
  // through without a start bubble makes updateIsDragging_ start a box
  // selection over the scripts sitting inside this frame.
  if ((e.ctrlKey || e.metaKey) && this.workspace.options.hasBoxSelect) {
    return;
  }
  if (gesture) {
    gesture.handleBubbleStart(e, this);
  }
};

/**
 * The blocks this frame owns. While the frame is collapsed this is the list it
 * recorded when it collapsed, because collapsing moved other scripts up into
 * the frame's footprint and made the positions unreliable. Otherwise it is
 * worked out from the positions.
 * @param {Object=} opt_measured PATCH 26: pre-measured top blocks, so a
 *     collapse does not have to walk the whole workspace twice.
 * @return {!Array.<!Blockly.BlockSvg>} The blocks inside this frame.
 * @package
 */
Blockly.Frame.prototype.getMembers = function(opt_measured) {
  if (!this.collapsed_) {
    return this.getContainedBlocks(opt_measured);
  }
  var blocks = [];
  for (var i = 0; i < this.blockIds_.length; i++) {
    var block = this.workspace.getBlockById(this.blockIds_[i]);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
};

/**
 * Find the top-level blocks sitting inside this frame. A block belongs to the
 * frame when the top left corner of its bounding box, which covers the whole
 * script stacked below it, lies within the frame's expanded rectangle. When
 * frames overlap, the smallest one that contains the block wins, so that a
 * frame inside another frame keeps its own scripts.
 * @param {Object=} opt_measured Top-level block measurements to reuse.
 * @return {!Array.<!Blockly.BlockSvg>} The blocks inside this frame.
 * @package
 */
Blockly.Frame.prototype.getContainedBlocks = function(opt_measured) {
  return this.getContainedBoxes_(opt_measured).blocks;
};

Blockly.Frame.measureTopBlocks_ = function(workspace) {
  var blocks = workspace.getTopBlocks(false);
  var boxes = [];
  for (var i = 0; i < blocks.length; i++) {
    boxes.push(blocks[i].getBoundingRectangle());
  }
  return {blocks: blocks, boxes: boxes};
};

Blockly.Frame.prototype.getContainedBoxes_ = function(opt_measured) {
  var frames = this.workspace.getTopFrames();
  var measured = opt_measured || Blockly.Frame.measureTopBlocks_(this.workspace);
  var contained = [];
  var containedBoxes = [];
  for (var i = 0; i < measured.blocks.length; i++) {
    var topLeft = measured.boxes[i].topLeft;
    if (!this.containsPoint(topLeft)) {
      continue;
    }
    // Only the smallest frame containing the block owns it.
    var smallest = this;
    for (var j = 0; j < frames.length; j++) {
      var other = frames[j];
      if (other != this &&
          other.containsPoint(topLeft) &&
          other.area_() < smallest.area_()) {
        smallest = other;
      }
    }
    if (smallest == this) {
      contained.push(measured.blocks[i]);
      containedBoxes.push(measured.boxes[i]);
    }
  }
  return {blocks: contained, boxes: containedBoxes};
};

/**
 * @return {number} The area of the frame's expanded rectangle.
 * @private
 */
Blockly.Frame.prototype.area_ = function() {
  return this.width_ * this.height_;
};

/**
 * Is the given point inside the frame's expanded rectangle? Uses the expanded
 * rectangle even while collapsed, so that a collapsed frame still knows which
 * scripts are its own.
 * @param {!goog.math.Coordinate} xy The point, in workspace units.
 * @return {boolean} True if the point is inside the frame.
 * @package
 */
Blockly.Frame.prototype.containsPoint = function(xy) {
  return xy.x >= this.xy_.x && xy.x <= this.xy_.x + this.width_ &&
      xy.y >= this.xy_.y && xy.y <= this.xy_.y + this.height_;
};

/**
 * Grow the frame so that every block inside it fits. Frames never shrink on
 * their own: the size the user dragged them to is a floor.
 * @param {Object=} opt_measured Top-level block measurements to reuse.
 * @package
 */
Blockly.Frame.prototype.growToFitBlocks = function(opt_measured) {
  if (this.collapsed_ || this.dragMembers_ || this.locked_) {
    return;
  }
  var boxes = this.getContainedBoxes_(opt_measured).boxes;
  if (!boxes.length) {
    return;
  }

  var pad = Blockly.Frame.PADDING;
  var right = this.xy_.x + this.width_;
  var bottom = this.xy_.y + this.height_;
  for (var i = 0; i < boxes.length; i++) {
    var box = boxes[i];
    right = Math.max(right, box.bottomRight.x + pad);
    bottom = Math.max(bottom, box.bottomRight.y + pad);
  }

  var width = right - this.xy_.x;
  var height = bottom - this.xy_.y;
  if (width == this.width_ && height == this.height_) {
    return;
  }

  Blockly.Events.fire(new Blockly.Events.FrameChange(this,
      {width: this.width_, height: this.height_},
      {width: width, height: height}));
  this.setSize(width, height);
};

/**
 * Show or hide the blocks inside the frame.
 * @param {boolean} visible Whether the blocks should be visible.
 * @private
 */
Blockly.Frame.prototype.setMembersVisible_ = function(visible) {
  var blocks = this.getMembers();
  for (var i = 0; i < blocks.length; i++) {
    var root = blocks[i].getSvgRoot();
    if (root) {
      root.style.display = visible ? '' : 'none';
    }
  }
};

/**
 * Collapse or expand the frame. PATCH 27 (2026-11-07): collapsing only hides
 * the scripts inside the frame. It no longer shifts anything below it -- the
 * workspace keeps every other block exactly where it was, at the cost of the
 * empty space the collapsed frame leaves behind.
 * @param {boolean} collapsed Whether the frame should be collapsed.
 * @package
 */
Blockly.Frame.prototype.setCollapsed = function(collapsed) {
  if (this.collapsed_ == collapsed) {
    return;
  }
  // Nothing below the frame moves now, so only the frame's own scripts have to
  // be materialised for this edit.
  this.materializeForEdit_(false);
  // PATCH 26 (2026-11-07): measure the top blocks once for getMembers instead
  // of letting it (and the old shift pass) each walk the whole workspace with
  // getBoundingRectangle(), which recursively visits every next-chain block.
  var measured = this.collapsed_ ? null :
      Blockly.Frame.measureTopBlocks_(this.workspace);
  // Read the members before the collapsed flag changes which list is in use.
  var members = this.getMembers(measured);
  var oldIds = this.blockIds_;
  var newIds = [];
  if (collapsed) {
    for (var i = 0; i < members.length; i++) {
      newIds.push(members[i].id);
    }
  }

  Blockly.Events.fire(new Blockly.Events.FrameChange(this,
      {collapsed: this.collapsed_, blockIds: oldIds},
      {collapsed: collapsed, blockIds: newIds}));

  this.collapsed_ = collapsed;
  this.blockIds_ = newIds;
  this.blockIdSet_ = null;
  // PATCH 27: deliberately no shiftContentBelow_ call. The frame shrinks to
  // its title bar, but every other block keeps its workspace coordinates.

  for (var j = 0; j < members.length; j++) {
    var root = members[j].getSvgRoot();
    if (root) {
      // A stack culled off-screen stays hidden when its frame expands.
      root.style.display = collapsed || members[j].intersects_ === false ?
          'none' : '';
    }
  }
  this.updateCollapseIcon_();

  this.setSize(this.width_, this.height_);
  this.workspace.resizeContents();
};

/**
 * Load scripts affected by a frame edit, leaving unrelated scripts unloaded.
 * @param {boolean} includeBelow Also materialise scripts below the frame.
 *     PATCH 27: collapsing no longer shifts those, so setCollapsed passes
 *     false; kept for frame drags and any future space-reclaiming mode.
 * @private
 */
Blockly.Frame.prototype.materializeForEdit_ = function(includeBelow) {
  var workspace = this.workspace;
  if (!workspace.getDeferredScripts || !workspace.materializeScriptsForBlockIds) return;
  var frame = this;
  var threshold = this.xy_.y + (this.collapsed_ ? Blockly.Frame.TOP_BAR_HEIGHT : this.height_);
  var ids = workspace.getTopBlocks(false).map(function(block) { return block.id; });
  // PATCH 26: build the id index once instead of a linear search per deferred
  // script (a large project can have thousands of both).
  var memberIds = frame.collapsed_ ? new Set(frame.blockIds_) : null;
  workspace.getDeferredScripts().forEach(function(script) {
    var member = memberIds ? memberIds.has(script.id) :
        frame.containsPoint(script);
    if (member || (includeBelow && script.y >= threshold)) ids.push(script.id);
  });
  workspace.materializeScriptsForBlockIds(ids);
};

/**
 * Move everything sitting below the frame up or down, so that collapsing the
 * frame reclaims the space it was taking up. The frame's own blocks are left
 * where they are: they get hidden instead.
 *
 * PATCH 27 (2026-11-07): setCollapsed no longer calls this -- collapsing must
 * not change any other block's position. The method stays (with its PATCH 26
 * optimisations) so the space-reclaiming behaviour can be restored without
 * reintroducing the quadratic scan.
 * @param {!Array.<!Blockly.BlockSvg>} members The blocks inside this frame.
 * @param {number} dy How far to move things, in workspace units.
 * @param {Object=} opt_measured PATCH 26: shared top-block measurement.
 * @private
 */
Blockly.Frame.prototype.shiftContentBelow_ = function(members, dy,
    opt_measured) {
  if (!dy) {
    return;
  }
  // Things below the frame as it is drawn right now.
  var threshold = this.xy_.y +
      (dy < 0 ? this.height_ : Blockly.Frame.TOP_BAR_HEIGHT);

  // PATCH 26 (2026-11-07): reuse the measurement taken in setCollapsed and
  // replace the per-block linear indexOf with an O(1) set lookup. On a large
  // project this loop alone was O(topBlocks x members).
  var measured = opt_measured ||
      Blockly.Frame.measureTopBlocks_(this.workspace);
  var memberSet = new Set(members);
  for (var i = 0; i < measured.blocks.length; i++) {
    var block = measured.blocks[i];
    if (memberSet.has(block)) {
      continue;
    }
    if (measured.boxes[i].topLeft.y >= threshold) {
      block.moveBy(0, dy);
    }
  }

  var frames = this.workspace.getTopFrames();
  for (var j = 0; j < frames.length; j++) {
    var frame = frames[j];
    if (frame != this && frame.getXY().y >= threshold) {
      frame.moveBy(0, dy);
    }
  }
};

/**
 * Handle a mouse-down on one of the title bar icons. Arms the icon, and stops
 * the click from starting a drag of the frame.
 * @param {!Event} e Mouse down event.
 * @private
 */
Blockly.Frame.prototype.iconMouseDown_ = function(e) {
  this.iconArmed_ = true;
  e.stopPropagation();
  e.preventDefault();
};

/**
 * Disarm an icon when the pointer leaves it, so that dragging off the icon
 * does not trigger it.
 * @private
 */
Blockly.Frame.prototype.iconMouseOut_ = function() {
  this.iconArmed_ = false;
};

/**
 * Toggle the frame's collapsed state.
 * @param {!Event} e Mouse up event.
 * @private
 */
Blockly.Frame.prototype.collapseMouseUp_ = function(e) {
  if (this.iconArmed_) {
    this.iconArmed_ = false;
    if (this.locked_) {
      e.stopPropagation();
      return;
    }
    Blockly.Events.setGroup(true);
    try {
      this.setCollapsed(!this.collapsed_);
    } finally {
      Blockly.Events.setGroup(false);
    }
  }
  e.stopPropagation();
};

/**
 * Delete the frame.
 * @param {!Event} e Mouse up event.
 * @private
 */
Blockly.Frame.prototype.deleteMouseUp_ = function(e) {
  if (this.iconArmed_) {
    this.iconArmed_ = false;
    if (this.locked_) {
      e.stopPropagation();
      return;
    }
    Blockly.Events.setGroup(true);
    try {
      this.dispose(true);
    } finally {
      Blockly.Events.setGroup(false);
    }
  }
  e.stopPropagation();
};

/**
 * Toggle the frame's locked state. This is the only edit a locked frame allows.
 * @param {!Event} e Mouse up event.
 * @private
 */
Blockly.Frame.prototype.lockMouseUp_ = function(e) {
  if (this.iconArmed_) {
    this.iconArmed_ = false;
    this.setLocked(!this.locked_);
  }
  e.stopPropagation();
};

/**
 * Start resizing the frame from its corner handle.
 * @param {!Event} e Mouse down event.
 * @private
 */
Blockly.Frame.prototype.resizeMouseDown_ = function(e) {
  if (this.locked_) {
    e.stopPropagation();
    return;
  }
  this.resizeStartSize_ = {width: this.width_, height: this.height_};
  this.workspace.setResizesEnabled(false);
  Blockly.hideChaff();

  this.onMouseUpWrapper_ = Blockly.bindEventWithChecks_(
      document, 'mouseup', this, this.resizeMouseUp_);
  this.onMouseMoveWrapper_ = Blockly.bindEventWithChecks_(
      document, 'mousemove', this, this.resizeMouseMove_);

  this.workspace.startDrag(e, new goog.math.Coordinate(
      this.workspace.RTL ? -this.width_ : this.width_, this.height_));

  e.stopPropagation();
};

/**
 * Resize the frame as the pointer moves.
 * @param {!Event} e Mouse move event.
 * @private
 */
Blockly.Frame.prototype.resizeMouseMove_ = function(e) {
  var newXY = this.workspace.moveDrag(e);
  // One change event is fired at the end of the resize instead.
  Blockly.Events.disable();
  try {
    this.setSize(this.workspace.RTL ? -newXY.x : newXY.x, newXY.y);
  } finally {
    Blockly.Events.enable();
  }
};

/**
 * Finish resizing the frame, and record the change for undo.
 * @private
 */
Blockly.Frame.prototype.resizeMouseUp_ = function() {
  Blockly.Touch.clearTouchIdentifier();
  this.unbindDragEvents_();

  var oldSize = this.resizeStartSize_;
  this.resizeStartSize_ = null;
  this.workspace.setResizesEnabled(true);

  if (oldSize && (oldSize.width != this.width_ ||
      oldSize.height != this.height_)) {
    Blockly.Events.fire(new Blockly.Events.FrameChange(this,
        {width: oldSize.width, height: oldSize.height},
        {width: this.width_, height: this.height_}));
  }
};

/**
 * Stop listening for the resize drag.
 * @private
 */
Blockly.Frame.prototype.unbindDragEvents_ = function() {
  if (this.onMouseUpWrapper_) {
    Blockly.unbindEvent_(this.onMouseUpWrapper_);
    this.onMouseUpWrapper_ = null;
  }
  if (this.onMouseMoveWrapper_) {
    Blockly.unbindEvent_(this.onMouseMoveWrapper_);
    this.onMouseMoveWrapper_ = null;
  }
};

/**
 * Tidy only the scripts inside this frame, leaving the frame where it is.
 * @package
 */
Blockly.Frame.prototype.cleanUpBlocks = function() {
  var members = this.getMembers();
  if (!members.length || !this.workspace.cleanUpBlocks) {
    return;
  }
  this.workspace.cleanUpBlocks(members,
      this.xy_.x + Blockly.Frame.PADDING,
      this.xy_.y + Blockly.Frame.TOP_BAR_HEIGHT + Blockly.Frame.PADDING);
};

/**
 * Resize and reposition the frame so it hugs its scripts, with padding on all
 * four sides and the title bar above the first row.
 * @package
 */
Blockly.Frame.prototype.fitToContent = function() {
  var members = this.getMembers();
  if (!members.length) {
    return;
  }
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  for (var i = 0; i < members.length; i++) {
    var stack = members[i].getDescendants(false);
    for (var j = 0; j < stack.length; j++) {
      var box = stack[j].getBoundingRectangle();
      if (!isFinite(box.topLeft.x) || !isFinite(box.bottomRight.y)) {
        continue;
      }
      minX = Math.min(minX, box.topLeft.x);
      minY = Math.min(minY, box.topLeft.y);
      maxX = Math.max(maxX, box.bottomRight.x);
      maxY = Math.max(maxY, box.bottomRight.y);
    }
  }
  if (!isFinite(minX) || !isFinite(maxX)) {
    return;
  }
  var pad = Blockly.Frame.PADDING;
  var header = Blockly.Frame.TOP_BAR_HEIGHT;
  var x = minX - pad;
  var y = minY - pad - header;
  var width = (maxX - minX) + (2 * pad);
  var height = (maxY - minY) + (2 * pad) + header;
  Blockly.Events.fire(new Blockly.Events.FrameChange(this,
      {x: this.xy_.x, y: this.xy_.y, width: this.width_, height: this.height_},
      {x: x, y: y, width: width, height: height}));
  this.translate(x, y);
  this.setSize(width, height);
  this.workspace.resizeContents();
};

/**
 * Delete the scripts inside this frame but keep the frame itself.
 * @package
 */
Blockly.Frame.prototype.deleteBlocks = function() {
  var members = this.getMembers();
  if (!members.length) {
    return;
  }
  Blockly.Events.setGroup(true);
  try {
    for (var i = 0; i < members.length; i++) {
      members[i].dispose(false, true);
    }
  } finally {
    Blockly.Events.setGroup(false);
  }
  this.workspace.resizeContents();
};

/**
 * Show the frame's context menu.
 * @param {!Event} e Mouse event.
 * @package
 */
Blockly.Frame.prototype.showContextMenu_ = function(e) {
  if (this.workspace.options.readOnly) {
    return;
  }
  var frame = this;
  var options = [];

  if (this.locked_) {
    options.push({
      text: Blockly.Msg.UNLOCK_FRAME,
      enabled: true,
      callback: function() {
        frame.setLocked(false);
      }
    });
    Blockly.ContextMenu.show(e, options, this.workspace.RTL, this);
    return;
  }

  options.push({
    text: Blockly.Msg.RENAME_FRAME,
    enabled: true,
    callback: function() {
      frame.startEditingTitle();
    }
  });

  options.push({
    text: Blockly.Msg.CHANGE_FRAME_COLOUR,
    enabled: true,
    callback: function() {
      frame.showColourPicker_();
    }
  });

  var hasBlocks = frame.getMembers().length > 0;
  options.push({
    text: Blockly.Msg.CLEAN_UP_FRAME,
    enabled: hasBlocks,
    callback: function() {
      frame.cleanUpBlocks();
    }
  });

  options.push({
    text: Blockly.Msg.FIT_FRAME_TO_CONTENT,
    enabled: hasBlocks && !frame.isCollapsed(),
    callback: function() {
      frame.fitToContent();
    }
  });

  options.push({
    text: Blockly.Msg.DELETE_FRAME_BLOCKS,
    enabled: hasBlocks,
    callback: function() {
      frame.deleteBlocks();
    }
  });

  options.push({
    text: this.collapsed_ ? Blockly.Msg.EXPAND_FRAME : Blockly.Msg.COLLAPSE_FRAME,
    enabled: true,
    callback: function() {
      Blockly.Events.setGroup(true);
      try {
        frame.setCollapsed(!frame.isCollapsed());
      } finally {
        Blockly.Events.setGroup(false);
      }
    }
  });

  options.push({
    text: Blockly.Msg.DELETE_FRAME,
    enabled: true,
    callback: function() {
      Blockly.Events.setGroup(true);
      try {
        frame.dispose(true);
      } finally {
        Blockly.Events.setGroup(false);
      }
    }
  });

  options.push({
    text: Blockly.Msg.LOCK_FRAME,
    enabled: true,
    callback: function() {
      frame.setLocked(true);
    }
  });

  Blockly.ContextMenu.show(e, options, this.workspace.RTL, this);
};

/**
 * Dispose of the frame. The scripts inside it are left alone, unless the frame
 * is being dropped on a delete area mid-drag, in which case they travelled
 * into it with the frame and go with it.
 * @param {boolean=} opt_animate True to play the delete sound and shrink
 *     animation, as blocks and comments do. Only user-facing deletions pass
 *     this; undo/redo and workspace teardown stay silent.
 * @package
 */
Blockly.Frame.prototype.dispose = function(opt_animate) {
  Blockly.ContextMenu.hideIfOwner(this);
  if (!this.workspace) {
    return;
  }
  var members = this.dragMembers_;
  if (members) {
    // Ends the drag, which fires the members' move events, so that undoing the
    // deletion puts them back where the drag started rather than in the
    // delete area.
    this.setDragging(false);
  }
  // Never leave the scripts inside a collapsed frame hidden. When the whole
  // workspace is being torn down the blocks are going away anyway, and
  // un-collapsing would shuffle everything else around on the way out.
  if (this.collapsed_ && !this.workspace.isClearing) {
    this.setCollapsed(false);
  }
  this.unbindDragEvents_();
  this.stopDragSurface_();
  if (opt_animate && this.rendered_ && !this.workspace.isClearing &&
      this.svgGroup_ && this.workspace.getAudioManager) {
    // A frame deleted from the trash still carries the delete-cursor class.
    this.setDeleteStyle(false);
    // The drag surface is gone by now, so getSvgXY() measures the frame on the
    // block canvas and the cloned shrink animation lands at the right spot
    // even when the deletion happened at the end of a drag.
    Blockly.BlockAnimations.disposeUiEffect(this);
  }

  if (Blockly.Events.isEnabled()) {
    Blockly.Events.fire(new Blockly.Events.FrameDelete(this));
  }

  var workspace = this.workspace;
  workspace.removeTopFrame(this);
  if (workspace.invalidateContentBounds_) {
    workspace.invalidateContentBounds_();
  }
  goog.dom.removeNode(this.svgGroup_);

  this.svgGroup_ = null;
  this.svgRect_ = null;
  this.svgTopBar_ = null;
  // Any open colour picker must not fire a change event for a disposed frame.
  Blockly.DropDownDiv.hideIfOwner(this);
  this.workspace = null;

  if (members) {
    for (var i = 0; i < members.length; i++) {
      members[i].dispose(false, true);
    }
  }

  workspace.resizeContents();
};

/**
 * Encode the frame as XML.
 * @return {!Element} The XML element.
 * @package
 */
Blockly.Frame.prototype.toXmlWithXY = function() {
  var element = goog.dom.createDom('frame');
  element.setAttribute('id', this.id);
  element.setAttribute('x', Math.round(this.xy_.x));
  element.setAttribute('y', Math.round(this.xy_.y));
  element.setAttribute('w', Math.round(this.width_));
  element.setAttribute('h', Math.round(this.height_));
  element.setAttribute('collapsed', this.collapsed_);
  element.setAttribute('locked', this.locked_);
  element.setAttribute('colour', this.colour_);
  if (this.collapsed_ && this.blockIds_.length) {
    element.setAttribute('blocks', this.blockIds_.join(','));
  }
  element.textContent = this.title_;
  return element;
};

/**
 * Create a frame from XML.
 * @param {!Element} xmlFrame The XML element.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace to put the frame on.
 * @return {!Blockly.Frame} The created frame.
 * @package
 */
Blockly.Frame.fromXml = function(xmlFrame, workspace) {
  var blocks = xmlFrame.getAttribute('blocks');
  return new Blockly.Frame(workspace, {
    id: xmlFrame.getAttribute('id'),
    blockIds: blocks ? blocks.split(',') : [],
    title: xmlFrame.textContent || '',
    colour: xmlFrame.getAttribute('colour') || Blockly.Frame.DEFAULT_COLOUR,
    x: parseInt(xmlFrame.getAttribute('x'), 10) || 0,
    y: parseInt(xmlFrame.getAttribute('y'), 10) || 0,
    width: parseInt(xmlFrame.getAttribute('w'), 10) || Blockly.Frame.DEFAULT_WIDTH,
    height: parseInt(xmlFrame.getAttribute('h'), 10) || Blockly.Frame.DEFAULT_HEIGHT,
    collapsed: xmlFrame.getAttribute('collapsed') == 'true',
    locked: xmlFrame.getAttribute('locked') == 'true'
  });
};

/**
 * Grow every frame on the workspace to fit the blocks inside it. Called when
 * blocks are created, moved, changed, or deleted, which is when the set of
 * blocks inside a frame can change.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace.
 * @param {!Blockly.Events.Abstract} event The event that just happened.
 * @package
 */
Blockly.Frame.onWorkspaceChange = function(workspace, event) {
  if (event.type != Blockly.Events.CREATE &&
      event.type != Blockly.Events.MOVE &&
      event.type != Blockly.Events.DELETE &&
      event.type != Blockly.Events.CHANGE) {
    return;
  }
  if (!workspace.topFrames_.length) {
    return;
  }
  // A frame drag has its members lifted onto a sibling SVG; measuring them now
  // would feed bogus coordinates into every frame's grow-to-fit pass.
  if (workspace.frameDragActiveBlocks_) {
    return;
  }
  var frames = workspace.getTopFrames();
  var measured = null;
  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    if (frame.isCollapsed()) {
      // A frame can be loaded already collapsed, and its blocks arrive after
      // it does, so keep hiding them as they turn up.
      frame.setMembersVisible_(false);
    } else if (!frame.dragMembers_ && !frame.isLocked()) {
      measured = measured || Blockly.Frame.measureTopBlocks_(workspace);
      frame.growToFitBlocks(measured);
    }
  }
};
