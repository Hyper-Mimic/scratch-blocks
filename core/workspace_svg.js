/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2014 Google Inc.
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
 * @fileoverview Object representing a workspace rendered as SVG.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

goog.provide('Blockly.WorkspaceSvg');

// TODO(scr): Fix circular dependencies
//goog.require('Blockly.BlockSvg');
goog.require('Blockly.Colours');
goog.require('Blockly.ConnectionDB');
goog.require('Blockly.constants');
goog.require('Blockly.DataCategory');
goog.require('Blockly.DropDownDiv');
goog.require('Blockly.Events.BlockCreate');
goog.require('Blockly.Gesture');
goog.require('Blockly.Grid');
goog.require('Blockly.Options');
goog.require('Blockly.scratchBlocksUtils');
goog.require('Blockly.ScrollbarPair');
goog.require('Blockly.Touch');
goog.require('Blockly.Trashcan');
//goog.require('Blockly.VerticalFlyout');
goog.require('Blockly.Workspace');
goog.require('Blockly.WorkspaceAudio');
goog.require('Blockly.WorkspaceComment');
goog.require('Blockly.WorkspaceCommentSvg');
goog.require('Blockly.WorkspaceCommentSvg.render');
goog.require('Blockly.WorkspaceDragSurfaceSvg');
goog.require('Blockly.Xml');
goog.require('Blockly.ZoomControls');
goog.require('Blockly.IntersectionObserver');

goog.require('goog.array');
goog.require('goog.dom');
goog.require('goog.math.Coordinate');
goog.require('goog.userAgent');
goog.require('goog.math.Rect');

/**
 * Class for a workspace.  This is an onscreen area with optional trashcan,
 * scrollbars, bubbles, and dragging.
 * @param {!Blockly.Options} options Dictionary of options.
 * @param {Blockly.BlockDragSurfaceSvg=} opt_blockDragSurface Drag surface for
 *     blocks.
 * @param {Blockly.WorkspaceDragSurfaceSvg=} opt_wsDragSurface Drag surface for
 *     the workspace.
 * @extends {Blockly.Workspace}
 * @constructor
 */
Blockly.WorkspaceSvg = function(options, opt_blockDragSurface, opt_wsDragSurface) {
  Blockly.WorkspaceSvg.superClass_.constructor.call(this, options);
  this.getMetrics =
      options.getMetrics || Blockly.WorkspaceSvg.getTopLevelWorkspaceMetrics_;
  this.setMetrics =
      options.setMetrics || Blockly.WorkspaceSvg.setTopLevelWorkspaceMetrics_;

  Blockly.ConnectionDB.init(this);

  if (opt_blockDragSurface) {
    this.blockDragSurface_ = opt_blockDragSurface;
  }

  if (opt_wsDragSurface) {
    this.workspaceDragSurface_ = opt_wsDragSurface;
  }

  this.useWorkspaceDragSurface_ =
      this.workspaceDragSurface_ && Blockly.utils.is3dSupported();

  /**
   * List of currently highlighted blocks.  Block highlighting is often used to
   * visually mark blocks currently being executed.
   * @type !Array.<!Blockly.BlockSvg>
   * @private
   */
  this.highlightedBlocks_ = [];

  /**
   * Object in charge of loading, storing, and playing audio for a workspace.
   * @type {Blockly.WorkspaceAudio}
   * @private
   */
  this.audioManager_ = new Blockly.WorkspaceAudio(options.parentWorkspace);

  /**
   * This workspace's grid object or null.
   * @type {Blockly.Grid}
   * @private
   */
  this.grid_ = this.options.gridPattern ?
      new Blockly.Grid(options.gridPattern, options.gridOptions) : null;

  this.registerToolboxCategoryCallback(Blockly.VARIABLE_CATEGORY_NAME,
      Blockly.DataCategory);
  this.registerToolboxCategoryCallback(Blockly.PROCEDURE_CATEGORY_NAME,
      Blockly.Procedures.flyoutCategory);

  this.procedureReturnsEnabled = Blockly.Procedures.DEFAULT_ENABLE_RETURNS;
  this.initialProcedureReturnTypes_ = null;
  this.procedureReturnChangeTimeout_ = null;
  this.checkProcedureReturnAfterGesture_ = false;

  // Two-finger pinch zoom (touch screens). pinch_ holds the state of a pinch in
  // progress, the rAF fields coalesce the zoom into one per frame, the same way
  // the wheel handler does.
  /** @type {?Object} @private */
  this.pinch_ = null;
  /** @type {boolean} @private */
  this.pinchRafScheduled_ = false;
  /** @type {number} @private */
  this.pinchRafId_ = null;
  /** @type {Array.<!Array.<!Object>>} @private */
  this.pinchListeners_ = [];

  // PATCH 9 (2026-10-10): cache of getBlocksBoundingBox(), in workspace units.
  // That call walks every top block/comment and recurses down each next-chain, so
  // it costs O(total blocks); it is reached from every getMetrics(), which itself
  // runs 1-3x per pan/zoom frame. The box only depends on content, never on the
  // view transform, so it can be reused across pan/zoom and recomputed only when
  // content actually changes.
  this.contentBoundingBox_ = null;
  this.contentBoundingBoxDirty_ = true;
  // Number of top blocks + top comments the cached box was built from. A cheap
  // O(1) sanity net: if anything adds or removes a top element without going
  // through invalidateContentBounds_(), the count mismatches and we recompute.
  this.contentBoundingBoxCount_ = 0;

  // Viewport culling: culled stacks may additionally be moved out of the
  // document (see BlockSvg.setUnloaded_). The layer holding them is deliberately
  // never attached to the DOM, so an unloaded stack costs nothing in style
  // recalculation, layout or paint. It is still an SVG element so that reading
  // a block's transform keeps working while it is away.
  this.viewportCullingEnabled_ = options.viewportCulling !== false;
  this.offscreenBlockLayer_ = null;
};
goog.inherits(Blockly.WorkspaceSvg, Blockly.Workspace);

/**
 * A wrapper function called when a resize event occurs.
 * You can pass the result to `unbindEvent_`.
 * @type {Array.<!Array>}
 */
Blockly.WorkspaceSvg.prototype.resizeHandlerWrapper_ = null;

/**
 * The render status of an SVG workspace.
 * Returns `false` for headless workspaces and true for instances of
 * `Blockly.WorkspaceSvg`.
 * @type {boolean}
 */
Blockly.WorkspaceSvg.prototype.rendered = true;

/**
 * Whether the workspace is visible.  False if the workspace has been hidden
 * by calling `setVisible(false)`.
 * @type {boolean}
 * @private
 */
Blockly.WorkspaceSvg.prototype.isVisible_ = true;

/**
 * Is this workspace the surface for a flyout?
 * @type {boolean}
 */
Blockly.WorkspaceSvg.prototype.isFlyout = false;

/**
 * Is this workspace the surface for a mutator?
 * @type {boolean}
 * @package
 */
Blockly.WorkspaceSvg.prototype.isMutator = false;

/**
 * Whether this workspace has resizes enabled.
 * Disable during batch operations for a performance improvement.
 * @type {boolean}
 * @private
 */
Blockly.WorkspaceSvg.prototype.resizesEnabled_ = true;

/**
 * Whether this workspace has toolbox/flyout refreshes enabled.
 * Disable during batch operations for a performance improvement.
 * @type {boolean}
 * @private
 */
Blockly.WorkspaceSvg.prototype.toolboxRefreshEnabled_ = true;

/**
 * Current horizontal scrolling offset in pixel units.
 * @type {number}
 */
Blockly.WorkspaceSvg.prototype.scrollX = 0;

/**
 * Current vertical scrolling offset in pixel units.
 * @type {number}
 */
Blockly.WorkspaceSvg.prototype.scrollY = 0;

/**
 * Horizontal scroll value when scrolling started in pixel units.
 * @type {number}
 */
Blockly.WorkspaceSvg.prototype.startScrollX = 0;

/**
 * Vertical scroll value when scrolling started in pixel units.
 * @type {number}
 */
Blockly.WorkspaceSvg.prototype.startScrollY = 0;

/**
 * Distance from mouse to object being dragged.
 * @type {goog.math.Coordinate}
 * @private
 */
Blockly.WorkspaceSvg.prototype.dragDeltaXY_ = null;

/**
 * Current scale.
 * @type {number}
 */
Blockly.WorkspaceSvg.prototype.scale = 1;

/**
 * The workspace's trashcan (if any).
 * @type {Blockly.Trashcan}
 */
Blockly.WorkspaceSvg.prototype.trashcan = null;

/**
 * This workspace's scrollbars, if they exist.
 * @type {Blockly.ScrollbarPair}
 */
Blockly.WorkspaceSvg.prototype.scrollbar = null;

/**
 * The current gesture in progress on this workspace, if any.
 * @type {Blockly.Gesture}
 * @private
 */
Blockly.WorkspaceSvg.prototype.currentGesture_ = null;

/**
 * This workspace's surface for dragging blocks, if it exists.
 * @type {Blockly.BlockDragSurfaceSvg}
 * @private
 */
Blockly.WorkspaceSvg.prototype.blockDragSurface_ = null;

/**
 * This workspace's drag surface, if it exists.
 * @type {Blockly.WorkspaceDragSurfaceSvg}
 * @private
 */
Blockly.WorkspaceSvg.prototype.workspaceDragSurface_ = null;

/**
  * Whether to move workspace to the drag surface when it is dragged.
  * True if it should move, false if it should be translated directly.
  * @type {boolean}
  * @private
  */
Blockly.WorkspaceSvg.prototype.useWorkspaceDragSurface_ = false;

/**
 * Whether the drag surface is actively in use. When true, calls to
 * translate will translate the drag surface instead of the translating the
 * workspace directly.
 * This is set to true in setupDragSurface and to false in resetDragSurface.
 * @type {boolean}
 * @private
 */
Blockly.WorkspaceSvg.prototype.isDragSurfaceActive_ = false;

/**
 * The first parent div with 'injectionDiv' in the name, or null if not set.
 * Access this with getInjectionDiv.
 * @type {!Element}
 * @private
 */
Blockly.WorkspaceSvg.prototype.injectionDiv_ = null;

/**
 * Last known position of the page scroll.
 * This is used to determine whether we have recalculated screen coordinate
 * stuff since the page scrolled.
 * @type {!goog.math.Coordinate}
 * @private
 */
Blockly.WorkspaceSvg.prototype.lastRecordedPageScroll_ = null;

/**
 * Map from function names to callbacks, for deciding what to do when a button
 * is clicked.
 * @type {!Object.<string, function(!Blockly.FlyoutButton)>}
 * @private
 */
Blockly.WorkspaceSvg.prototype.flyoutButtonCallbacks_ = {};

/**
 * Map from function names to callbacks, for deciding what to do when a custom
 * toolbox category is opened.
 * @type {!Object.<string, function(!Blockly.Workspace):!Array.<!Element>>}
 * @private
 */
Blockly.WorkspaceSvg.prototype.toolboxCategoryCallbacks_ = {};

/**
 * Inverted screen CTM, for use in mouseToSvg.
 * @type {SVGMatrix}
 * @private
 */
Blockly.WorkspaceSvg.prototype.inverseScreenCTM_ = null;

/**
 * Inverted screen CTM is dirty.
 * @type {Boolean}
 * @private
 */
Blockly.WorkspaceSvg.prototype.inverseScreenCTMDirty_ = true;

/**
 * Getter for the inverted screen CTM.
 * @return {SVGMatrix} The matrix to use in mouseToSvg
 */
Blockly.WorkspaceSvg.prototype.getInverseScreenCTM = function() {

  // Defer getting the screen CTM until we actually need it, this should
  // avoid forced reflows from any calls to updateInverseScreenCTM.
  if (this.inverseScreenCTMDirty_) {
    var ctm = this.getParentSvg().getScreenCTM();
    if (ctm) {
      this.inverseScreenCTM_ = ctm.inverse();
      this.inverseScreenCTMDirty_ = false;
    }
  }

  return this.inverseScreenCTM_;
};

/**
 * Getter for isVisible
 * @return {boolean} Whether the workspace is visible.  False if the workspace has been hidden
 * by calling `setVisible(false)`.
 */
Blockly.WorkspaceSvg.prototype.isVisible = function() {
  return this.isVisible_;
};

/**
 * Mark the inverse screen CTM as dirty.
 */
Blockly.WorkspaceSvg.prototype.updateInverseScreenCTM = function() {
  this.inverseScreenCTMDirty_ = true;
};

/**
 * Return the absolute coordinates of the top-left corner of this element,
 * scales that after canvas SVG element, if it's a descendant.
 * The origin (0,0) is the top-left corner of the Blockly SVG.
 * @param {!Element} element Element to find the coordinates of.
 * @return {!goog.math.Coordinate} Object with .x and .y properties.
 * @private
 */
Blockly.WorkspaceSvg.prototype.getSvgXY = function(element) {
  var x = 0;
  var y = 0;
  var scale = 1;
  if (goog.dom.contains(this.getCanvas(), element) ||
      goog.dom.contains(this.getBubbleCanvas(), element)) {
    // Before the SVG canvas, scale the coordinates.
    scale = this.scale;
  }
  do {
    // Loop through this block and every parent.
    var xy = Blockly.utils.getRelativeXY(element);
    if (element == this.getCanvas() ||
        element == this.getBubbleCanvas()) {
      // After the SVG canvas, don't scale the coordinates.
      scale = 1;
    }
    x += xy.x * scale;
    y += xy.y * scale;
    element = element.parentNode;
  } while (element && element != this.getParentSvg());
  return new goog.math.Coordinate(x, y);
};

/**
 * Return the position of the workspace origin relative to the injection div
 * origin in pixels.
 * The workspace origin is where a block would render at position (0, 0).
 * It is not the upper left corner of the workspace SVG.
 * @return {!goog.math.Coordinate} Offset in pixels.
 * @package
 */
Blockly.WorkspaceSvg.prototype.getOriginOffsetInPixels = function() {
  return Blockly.utils.getInjectionDivXY_(this.svgBlockCanvas_);
};

/**
 * Return the injection div that is a parent of this workspace.
 * Walks the DOM the first time it's called, then returns a cached value.
 * @return {!Element} The first parent div with 'injectionDiv' in the name.
 * @package
 */
Blockly.WorkspaceSvg.prototype.getInjectionDiv = function() {
  // NB: it would be better to pass this in at createDom, but is more likely to
  // break existing uses of Blockly.
  if (!this.injectionDiv_) {
    var element = this.svgGroup_;
    while (element) {
      var classes = element.getAttribute('class') || '';
      if ((' ' + classes + ' ').indexOf(' injectionDiv ') != -1) {
        this.injectionDiv_ = element;
        break;
      }
      element = element.parentNode;
    }
  }
  return this.injectionDiv_;
};

/**
 * Save resize handler data so we can delete it later in dispose.
 * @param {!Array.<!Array>} handler Data that can be passed to unbindEvent_.
 */
Blockly.WorkspaceSvg.prototype.setResizeHandlerWrapper = function(handler) {
  this.resizeHandlerWrapper_ = handler;
};

/**
 * Create the workspace DOM elements.
 * @param {string=} opt_backgroundClass Either 'blocklyMainBackground' or
 *     'blocklyMutatorBackground'.
 * @return {!Element} The workspace's SVG group.
 */
Blockly.WorkspaceSvg.prototype.createDom = function(opt_backgroundClass) {
  /**
   * <g class="blocklyWorkspace">
   *   <rect class="blocklyMainBackground" height="100%" width="100%"></rect>
   *   [Trashcan and/or flyout may go here]
   *   <g class="blocklyBlockCanvas"></g>
   *   <g class="blocklyBubbleCanvas"></g>
   * </g>
   * @type {SVGElement}
   */
  this.svgGroup_ = Blockly.utils.createSvgElement('g',
      {'class': 'blocklyWorkspace'}, null);

  // Note that a <g> alone does not receive mouse events--it must have a
  // valid target inside it.  If no background class is specified, as in the
  // flyout, the workspace will not receive mouse events.
  if (opt_backgroundClass) {
    // PATCH 14 (2026-10-11): the grid-bearing background rect is oversized and
    // carries the pan/zoom transform (see Blockly.Grid.attachBackground). A
    // viewport-sized rect would slide out of view as soon as it is translated,
    // and re-sizing it on every pan is exactly the work being avoided here.
    var isMainBackground =
        opt_backgroundClass == 'blocklyMainBackground' && this.grid_;
    var backgroundAttrs = {'class': opt_backgroundClass};
    if (isMainBackground) {
      backgroundAttrs['x'] = -50000;
      backgroundAttrs['y'] = -50000;
      backgroundAttrs['width'] = 100000;
      backgroundAttrs['height'] = 100000;
    } else {
      backgroundAttrs['height'] = '100%';
      backgroundAttrs['width'] = '100%';
    }
    /** @type {SVGElement} */
    this.svgBackground_ = Blockly.utils.createSvgElement('rect',
        backgroundAttrs, this.svgGroup_);

    if (isMainBackground) {
      this.svgBackground_.style.fill =
          'url(#' + this.grid_.getPatternId() + ')';
      this.grid_.attachBackground(this.svgBackground_);
    }
  }
  /** @type {SVGElement} */
  this.svgBlockCanvas_ = Blockly.utils.createSvgElement('g',
      {'class': 'blocklyBlockCanvas'}, this.svgGroup_, this);
  /** @type {SVGElement} */
  this.svgBubbleCanvas_ = Blockly.utils.createSvgElement('g',
      {'class': 'blocklyBubbleCanvas'}, this.svgGroup_, this);
  var bottom = Blockly.Scrollbar.scrollbarThickness;
  if (this.options.hasTrashcan) {
    bottom = this.addTrashcan_(bottom);
  }
  if (this.options.zoomOptions && this.options.zoomOptions.controls) {
    this.addZoomControls_(bottom);
  }

  if (!this.isFlyout) {
    Blockly.bindEventWithChecks_(this.svgGroup_, 'mousedown', this,
        this.onMouseDown_);
    if (this.options.zoomOptions && this.options.zoomOptions.wheel) {
      // Mouse-wheel.
      Blockly.bindEventWithChecks_(this.svgGroup_, 'wheel', this,
          this.onMouseWheel_);
    }
    this.initPinchZoom_();
  }

  this.intersectionObserver = new Blockly.IntersectionObserver(this);

  // Determine if there needs to be a category tree, or a simple list of
  // blocks.  This cannot be changed later, since the UI is very different.
  if (this.options.hasCategories) {
    /**
     * @type {Blockly.Toolbox}
     * @private
     */
    this.toolbox_ = new Blockly.Toolbox(this);
  }
  if (this.grid_) {
    this.grid_.update(this.scale);
  }
  this.recordCachedAreas();
  return this.svgGroup_;
};

/**
 * Dispose of this workspace.
 * Unlink from all DOM elements to prevent memory leaks.
 */
Blockly.WorkspaceSvg.prototype.dispose = function() {
  // Stop rerendering.
  this.rendered = false;
  if (this.currentGesture_) {
    this.currentGesture_.cancel();
  }
  // Cancel any coalesced wheel frames so a disposed workspace can't fire
  // them later (same reasoning as WorkspaceDragger.dispose). (2026-10-17)
  if (window.cancelAnimationFrame) {
    if (this.wheelRafScheduled_ && this.wheelRafId_) {
      window.cancelAnimationFrame(this.wheelRafId_);
    }
    if (this.zoomRafScheduled_ && this.zoomRafId_) {
      window.cancelAnimationFrame(this.zoomRafId_);
    }
  }
  this.wheelRafScheduled_ = false;
  this.wheelRafId_ = null;
  this.zoomRafScheduled_ = false;
  this.zoomRafId_ = null;
  this.pendingZoomDelta_ = 0;
  // Stop listening for pinch gestures, and drop a pending zoom frame.
  for (var i = 0; i < this.pinchListeners_.length; i++) {
    document.removeEventListener(this.pinchListeners_[i][0],
        this.pinchListeners_[i][1], {capture: true});
  }
  this.pinchListeners_.length = 0;
  this.pinch_ = null;
  if (this.pinchRafScheduled_ && this.pinchRafId_) {
    window.cancelAnimationFrame(this.pinchRafId_);
  }
  this.pinchRafScheduled_ = false;
  this.pinchRafId_ = null;
  if (this.intersectionObserver) {
    this.intersectionObserver.dispose();
    this.intersectionObserver = null;
  }
  Blockly.WorkspaceSvg.superClass_.dispose.call(this);
  if (this.svgGroup_) {
    goog.dom.removeNode(this.svgGroup_);
    this.svgGroup_ = null;
  }
  this.svgBlockCanvas_ = null;
  this.svgBubbleCanvas_ = null;
  this.offscreenBlockLayer_ = null;
  if (this.toolbox_) {
    this.toolbox_.dispose();
    this.toolbox_ = null;
  }
  if (this.flyout_) {
    this.flyout_.dispose();
    this.flyout_ = null;
  }
  if (this.trashcan) {
    this.trashcan.dispose();
    this.trashcan = null;
  }
  if (this.scrollbar) {
    this.scrollbar.dispose();
    this.scrollbar = null;
  }
  if (this.zoomControls_) {
    this.zoomControls_.dispose();
    this.zoomControls_ = null;
  }

  if (this.audioManager_) {
    this.audioManager_.dispose();
    this.audioManager_ = null;
  }

  if (this.grid_) {
    this.grid_.dispose();
    this.grid_ = null;
  }

  if (this.toolboxCategoryCallbacks_) {
    this.toolboxCategoryCallbacks_ = null;
  }
  if (this.flyoutButtonCallbacks_) {
    this.flyoutButtonCallbacks_ = null;
  }
  if (!this.options.parentWorkspace) {
    // Top-most workspace.  Dispose of the div that the
    // SVG is injected into (i.e. injectionDiv).
    goog.dom.removeNode(this.getParentSvg().parentNode);
  }
  if (this.resizeHandlerWrapper_) {
    Blockly.unbindEvent_(this.resizeHandlerWrapper_);
    this.resizeHandlerWrapper_ = null;
  }
  if (this.procedureReturnChangeTimeout_) {
    clearTimeout(this.procedureReturnChangeTimeout_);
  }
};

/**
 * Obtain a newly created block.
 * @param {?string} prototypeName Name of the language object containing
 *     type-specific functions for this block.
 * @param {string=} opt_id Optional ID.  Use this ID if provided, otherwise
 *     create a new ID.
 * @return {!Blockly.BlockSvg} The created block.
 */
Blockly.WorkspaceSvg.prototype.newBlock = function(prototypeName, opt_id) {
  return new Blockly.BlockSvg(this, prototypeName, opt_id);
};

/**
 * Add a trashcan.
 * @param {number} bottom Distance from workspace bottom to bottom of trashcan.
 * @return {number} Distance from workspace bottom to the top of trashcan.
 * @private
 */
Blockly.WorkspaceSvg.prototype.addTrashcan_ = function(bottom) {
  /** @type {Blockly.Trashcan} */
  this.trashcan = new Blockly.Trashcan(this);
  var svgTrashcan = this.trashcan.createDom();
  this.svgGroup_.insertBefore(svgTrashcan, this.svgBlockCanvas_);
  return this.trashcan.init(bottom);
};

/**
 * Add zoom controls.
 * @param {number} bottom Distance from workspace bottom to bottom of controls.
 * @return {number} Distance from workspace bottom to the top of controls.
 * @private
 */
Blockly.WorkspaceSvg.prototype.addZoomControls_ = function(bottom) {
  /** @type {Blockly.ZoomControls} */
  this.zoomControls_ = new Blockly.ZoomControls(this);
  var svgZoomControls = this.zoomControls_.createDom();
  this.svgGroup_.appendChild(svgZoomControls);
  return this.zoomControls_.init(bottom);
};

/**
 * Add a flyout element in an element with the given tag name.
 * @param {string} tagName What type of tag the flyout belongs in.
 * @return {!Element} The element containing the flyout DOM.
 * @private
 */
Blockly.WorkspaceSvg.prototype.addFlyout_ = function(tagName) {
  var workspaceOptions = {
    disabledPatternId: this.options.disabledPatternId,
    parentWorkspace: this,
    RTL: this.RTL,
    oneBasedIndex: this.options.oneBasedIndex,
    horizontalLayout: this.horizontalLayout,
    toolboxPosition: this.options.toolboxPosition,
    stackGlowFilterId: this.options.stackGlowFilterId
  };
  if (this.horizontalLayout) {
    this.flyout_ = new Blockly.HorizontalFlyout(workspaceOptions);
  } else {
    this.flyout_ = new Blockly.VerticalFlyout(workspaceOptions);
  }
  this.flyout_.autoClose = false;

  // Return the element  so that callers can place it in their desired
  // spot in the DOM.  For example, mutator flyouts do not go in the same place
  // as main workspace flyouts.
  return this.flyout_.createDom(tagName);
};

/**
 * Getter for the flyout associated with this workspace.  This flyout may be
 * owned by either the toolbox or the workspace, depending on toolbox
 * configuration.  It will be null if there is no flyout.
 * @return {Blockly.Flyout} The flyout on this workspace.
 * @package
 */
Blockly.WorkspaceSvg.prototype.getFlyout = function() {
  if (this.flyout_) {
    return this.flyout_;
  }
  if (this.toolbox_) {
    return this.toolbox_.flyout_;
  }
  return null;
};

/**
 * Getter for the toolbox associated with this workspace, if one exists.
 * @return {Blockly.Toolbox} The toolbox on this workspace.
 * @package
 */
Blockly.WorkspaceSvg.prototype.getToolbox = function() {
  return this.toolbox_;
};

/**
 * Update items that use screen coordinate calculations
 * because something has changed (e.g. scroll position, window size).
 * @private
 */
Blockly.WorkspaceSvg.prototype.updateScreenCalculations_ = function() {
  this.updateInverseScreenCTM();
  this.recordCachedAreas();
};

/**
 * If enabled, resize the parts of the workspace that change when the workspace
 * contents (e.g. block positions) change.  This will also scroll the
 * workspace contents if needed.
 * @package
 */
Blockly.WorkspaceSvg.prototype.resizeContents = function(opt_element) {
  // PATCH 9 (2026-10-10): this is the hub every content mutation funnels through
  // (block moveBy/render/dispose, comment moveBy/dispose all end up here). Mark
  // the bounds cache stale BEFORE the early-return, otherwise a suppressed resize
  // would leave a stale box behind.
  // PATCH 12 (2026-10-10): opt_element names the one top block/comment whose
  // stack actually changed, so only that stack has to be re-measured. Callers
  // that cannot name it (clear, xml import, resize resume) still omit it and get
  // the previous whole-workspace invalidate.
  this.invalidateContentBounds_(opt_element);
  if (this.contentUpdateDepth_) {
    // PATCH 13 (2026-10-10): inside a content-update batch (stack disposal) the
    // scrollbar half is deferred to endContentUpdate_, which runs it once for
    // the whole batch. Disposing an N-deep stack used to do it N times.
    return;
  }
  this.performContentResize_();
};

/**
 * PATCH 13 (2026-10-10): the expensive half of resizeContents(), split out so a
 * batch can run it exactly once. Invalidates nothing -- callers are responsible
 * for having marked whatever changed.
 * @package
 */
Blockly.WorkspaceSvg.prototype.performContentResize_ = function() {
  if (!this.resizesEnabled_ || !this.rendered) {
    return;
  }
  if (this.scrollbar) {
    // TODO(picklesrus): Once rachel-fenichel's scrollbar refactoring
    // is complete, call the method that only resizes scrollbar
    // based on contents.
    this.scrollbar.resize();
  }
  this.updateInverseScreenCTM();
};

/**
 * PATCH 13 (2026-10-10): bracket a burst of content mutations so the workspace
 * resizes its scrollbars/bounds once at the end instead of once per mutated
 * block. Reentrant: only the outermost pair performs the resize.
 * @package
 */
Blockly.WorkspaceSvg.prototype.beginContentUpdate_ = function() {
  this.contentUpdateDepth_ = (this.contentUpdateDepth_ || 0) + 1;
};

Blockly.WorkspaceSvg.prototype.endContentUpdate_ = function() {
  if (!this.contentUpdateDepth_) {
    return;
  }
  this.contentUpdateDepth_--;
  if (this.contentUpdateDepth_ === 0) {
    this.performContentResize_();
  }
};

Blockly.WorkspaceSvg.prototype.queueIntersectionCheck = function() {
  if (this.intersectionObserver) {
    this.intersectionObserver.queueIntersectionCheck();
  }
};

/**
 * The container that holds SVG roots of unloaded stacks. It is created lazily
 * and never appended to the document, which is the whole point: an unloaded
 * stack must not take part in style resolution or paint. Returns null once the
 * workspace has been disposed.
 * @return {?Element}
 * @package
 */
Blockly.WorkspaceSvg.prototype.getOffscreenBlockLayer_ = function() {
  if (!this.rendered) {
    return null;
  }
  if (!this.offscreenBlockLayer_) {
    this.offscreenBlockLayer_ = Blockly.utils.createSvgElement('g', {
      'class': 'blocklyOffscreenBlocks'
    }, null);
  }
  return this.offscreenBlockLayer_;
};

/**
 * Whether a block is currently being moved by the user. Panning the workspace
 * and wheel scrolling are deliberately not included: the canvas and its anchors
 * move together, so unloading stays safe, and those are exactly the gestures
 * that need it most.
 * @return {boolean}
 * @package
 */
Blockly.WorkspaceSvg.prototype.isMovingBlocks_ = function() {
  var gesture = this.currentGesture_;
  if (gesture && (gesture.isDraggingBlock_ || gesture.isBoxDragging_)) {
    return true;
  }
  var surface = this.blockDragSurface_;
  return !!(surface && typeof surface.getCurrentBlock === 'function' &&
      surface.getCurrentBlock());
};

/**
 * Turn viewport culling (and with it, unloading stacks from the document) on or
 * off at runtime. Turning it off restores every unloaded stack.
 * @param {boolean} enabled True to enable.
 * @package
 */
Blockly.WorkspaceSvg.prototype.setViewportCullingEnabled = function(enabled) {
  this.viewportCullingEnabled_ = !!enabled;
  if (!this.viewportCullingEnabled_) {
    var blocks = this.getTopBlocks(false);
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].unloaded_) {
        blocks[i].attachToCanvas_(true);
      }
    }
  }
  this.queueIntersectionCheck();
};

/**
 * Call *before* modifying scripts.
 */
Blockly.WorkspaceSvg.prototype.procedureReturnsWillChange = function() {
  if (this.initialProcedureReturnTypes_) {
    // Already queued.
    return;
  }

  this.initialProcedureReturnTypes_ = Blockly.Procedures.getAllProcedureReturnTypes(this);

  if (this.currentGesture_) {
    this.checkProcedureReturnAfterGesture_ = true;
  } else {
    this.procedureReturnChangeTimeout_ = setTimeout(this.processProcedureReturnsChanged_.bind(this));
  }
};

/**
 * @private
 */
Blockly.WorkspaceSvg.prototype.processProcedureReturnsChanged_ = function() {
  var initialTypes = this.initialProcedureReturnTypes_;
  var finalTypes = Blockly.Procedures.getAllProcedureReturnTypes(this);

  this.initialProcedureReturnTypes_ = null;
  this.checkProcedureReturnAfterGesture_ = false;
  this.procedureReturnChangeTimeout_ = null;

  Blockly.Events.setGroup(true);
  var topBlocks = this.getTopBlocks(false);
  for (var i = 0; i < topBlocks.length; i++) {
    var block = topBlocks[i];
    if (block.type !== Blockly.PROCEDURES_CALL_BLOCK_TYPE) continue;

    // After a gesture, we are called early enough that there could still be insertion markers.
    if (block.isInsertionMarker()) continue;

    // Because this block is a top block, it by definition won't have a parent, but if another
    // block is connected below, we should leave it unchanged instead of unplugging.
    if (block.getNextBlock()) continue;

    var procCode = block.getProcCode();
    // If the procedure doesn't exist or is new, ignore it.
    if (
      !Object.prototype.hasOwnProperty.call(initialTypes, procCode) ||
      !Object.prototype.hasOwnProperty.call(finalTypes, procCode)
    ) continue;

    var actualReturnType = finalTypes[procCode];
    if (
      block.getReturn() !== actualReturnType &&
      // If user is allowed to override call block shape, only update the shape if the definition's
      // shape has actually changed.
      (!Blockly.Procedures.USER_CAN_CHANGE_CALL_TYPE || initialTypes[procCode] !== actualReturnType)
    ) {
      Blockly.Procedures.changeReturnType(block, actualReturnType);
    }
  }
  Blockly.Events.setGroup(false);

  // Toolbox refresh can be slow, so only do when needed.
  var toolboxOutdated = false;
  for (var procCode in finalTypes) {
    // If a current procedure existed but its type has changed, the toolbox must be updated.
    // If a new procedure was created, the toolbox is already updated elsewhere.
    if (
      Object.prototype.hasOwnProperty.call(initialTypes, procCode) &&
      initialTypes[procCode] !== finalTypes[procCode]
    ) {
      toolboxOutdated = true;
      break;
    }
  }
  if (toolboxOutdated) {
    this.refreshToolboxSelection_();
  }
};

/**
 * Does not refresh toolbox.
 */
Blockly.WorkspaceSvg.prototype.enableProcedureReturns = function() {
  this.procedureReturnsEnabled = true;
};

/**
 * Resize and reposition all of the workspace chrome (toolbox,
 * trash, scrollbars etc.)
 * This should be called when something changes that
 * requires recalculating dimensions and positions of the
 * trash, zoom, toolbox, etc. (e.g. window resize).
 */
Blockly.WorkspaceSvg.prototype.resize = function() {
  if (this.toolbox_) {
    this.toolbox_.position();
  }
  if (this.flyout_) {
    this.flyout_.position();
  }
  if (this.trashcan) {
    this.trashcan.position();
  }
  if (this.zoomControls_) {
    this.zoomControls_.position();
  }
  if (this.scrollbar) {
    this.scrollbar.resize();
  }
  this.updateScreenCalculations_();
  this.queueIntersectionCheck();
};

/**
 * Resizes and repositions workspace chrome if the page has a new
 * scroll position.
 * @package
 */
Blockly.WorkspaceSvg.prototype.updateScreenCalculationsIfScrolled
    = function() {
  /* eslint-disable indent */
  var currScroll = goog.dom.getDocumentScroll();
  if (!goog.math.Coordinate.equals(this.lastRecordedPageScroll_,
     currScroll)) {
    this.lastRecordedPageScroll_ = currScroll;
    this.updateScreenCalculations_();
  }
}; /* eslint-enable indent */

/**
 * Get the SVG element that forms the drawing surface.
 * @return {!Element} SVG element.
 */
Blockly.WorkspaceSvg.prototype.getCanvas = function() {
  return this.svgBlockCanvas_;
};

/**
 * Get the SVG element that forms the bubble surface.
 * @return {!SVGGElement} SVG element.
 */
Blockly.WorkspaceSvg.prototype.getBubbleCanvas = function() {
  return this.svgBubbleCanvas_;
};

/**
 * Get the SVG element that contains this workspace.
 * @return {!Element} SVG element.
 */
Blockly.WorkspaceSvg.prototype.getParentSvg = function() {
  if (this.cachedParentSvg_) {
    return this.cachedParentSvg_;
  }
  var element = this.svgGroup_;
  while (element) {
    if (element.tagName == 'svg') {
      this.cachedParentSvg_ = element;
      return element;
    }
    element = element.parentNode;
  }
  return null;
};

/**
 * Translate this workspace to new coordinates.
 * @param {number} x Horizontal translation.
 * @param {number} y Vertical translation.
 */
Blockly.WorkspaceSvg.prototype.translate = function(x, y) {
  if (this.useWorkspaceDragSurface_ && this.isDragSurfaceActive_) {
    this.workspaceDragSurface_.translateSurface(x,y);
  } else {
    var translation = 'translate(' + x + ',' + y + ') ' +
        'scale(' + this.scale + ')';
    this.svgBlockCanvas_.setAttribute('transform', translation);
    this.svgBubbleCanvas_.setAttribute('transform', translation);
  }
  // Now update the block drag surface if we're using one.
  if (this.blockDragSurface_) {
    this.blockDragSurface_.translateAndScaleGroup(x, y, this.scale);
  }
  this.queueIntersectionCheck();
};

/**
 * Called at the end of a workspace drag to take the contents
 * out of the drag surface and put them back into the workspace SVG.
 * Does nothing if the workspace drag surface is not enabled.
 * @package
 */
Blockly.WorkspaceSvg.prototype.resetDragSurface = function() {
  // Don't do anything if we aren't using a drag surface.
  if (!this.useWorkspaceDragSurface_) {
    return;
  }

  this.isDragSurfaceActive_ = false;

  var trans = this.workspaceDragSurface_.getSurfaceTranslation();
  this.workspaceDragSurface_.clearAndHide(this.svgGroup_);
  var translation = 'translate(' + trans.x + ',' + trans.y + ') ' +
      'scale(' + this.scale + ')';
  this.svgBlockCanvas_.setAttribute('transform', translation);
  this.svgBubbleCanvas_.setAttribute('transform', translation);
};

/**
 * Called at the beginning of a workspace drag to move contents of
 * the workspace to the drag surface.
 * Does nothing if the drag surface is not enabled.
 * @package
 */
Blockly.WorkspaceSvg.prototype.setupDragSurface = function() {
  // Don't do anything if we aren't using a drag surface.
  if (!this.useWorkspaceDragSurface_) {
    return;
  }

  // This can happen if the user starts a drag, mouses up outside of the
  // document where the mouseup listener is registered (e.g. outside of an
  // iframe) and then moves the mouse back in the workspace.  On mobile and ff,
  // we get the mouseup outside the frame. On chrome and safari desktop we do
  // not.
  if (this.isDragSurfaceActive_) {
    return;
  }

  this.isDragSurfaceActive_ = true;

  // Figure out where we want to put the canvas back.  The order
  // in the is important because things are layered.
  var previousElement = this.svgBlockCanvas_.previousSibling;
  var width = parseInt(this.getParentSvg().getAttribute('width'), 10);
  var height = parseInt(this.getParentSvg().getAttribute('height'), 10);
  var coord = Blockly.utils.getRelativeXY(this.svgBlockCanvas_);
  this.workspaceDragSurface_.setContentsAndShow(this.svgBlockCanvas_,
      this.svgBubbleCanvas_, previousElement, width, height, this.scale);
  this.workspaceDragSurface_.translateSurface(coord.x, coord.y);
};

/**
 * @return {?Blockly.BlockDragSurfaceSvg} This workspace's block drag surface,
 *     if one is in use.
 * @package
 */
Blockly.WorkspaceSvg.prototype.getBlockDragSurface = function() {
  return this.blockDragSurface_;
};

/**
 * Returns the horizontal offset of the workspace.
 * Intended for LTR/RTL compatibility in XML.
 * @return {number} Width.
 */
Blockly.WorkspaceSvg.prototype.getWidth = function() {
  var metrics = this.getMetrics();
  return metrics ? metrics.viewWidth / this.scale : 0;
};

/**
 * Toggles the visibility of the workspace.
 * Currently only intended for main workspace.
 * @param {boolean} isVisible True if workspace should be visible.
 */
Blockly.WorkspaceSvg.prototype.setVisible = function(isVisible) {

  // Tell the scrollbar whether its container is visible so it can
  // tell when to hide itself.
  if (this.scrollbar) {
    this.scrollbar.setContainerVisible(isVisible);
  }

  // Tell the flyout whether its container is visible so it can
  // tell when to hide itself.
  if (this.getFlyout()) {
    this.getFlyout().setContainerVisible(isVisible);
  }

  this.getParentSvg().style.display = isVisible ? 'block' : 'none';
  if (this.toolbox_) {
    // Currently does not support toolboxes in mutators.
    this.toolbox_.HtmlDiv.style.display = isVisible ? 'block' : 'none';
  }
  if (isVisible) {
    this.render();
    // The window may have changed size while the workspace was hidden.
    // Resize recalculates scrollbar position, delete areas, etc.
    this.resize();
  } else {
    Blockly.hideChaff(true);
    Blockly.DropDownDiv.hideWithoutAnimation();
  }
  this.isVisible_ = isVisible;
};

/**
 * Render all blocks in workspace.
 */
Blockly.WorkspaceSvg.prototype.render = function() {
  // Generate list of all blocks.
  var blocks = this.getAllBlocks();
  // Render each block.
  for (var i = blocks.length - 1; i >= 0; i--) {
    blocks[i].render(false);
  }
};

/**
 * Was used back when block highlighting (for execution) and block selection
 * (for editing) were the same thing.
 * Any calls of this function can be deleted.
 * @deprecated October 2016
 */
Blockly.WorkspaceSvg.prototype.traceOn = function() {
  console.warn('Deprecated call to traceOn, delete this.');
};

/**
 * Highlight or unhighlight a block in the workspace.  Block highlighting is
 * often used to visually mark blocks currently being executed.
 * @param {?string} id ID of block to highlight/unhighlight,
 *   or null for no block (used to unhighlight all blocks).
 * @param {boolean=} opt_state If undefined, highlight specified block and
 * automatically unhighlight all others.  If true or false, manually
 * highlight/unhighlight the specified block.
 */
Blockly.WorkspaceSvg.prototype.highlightBlock = function(id, opt_state) {
  if (opt_state === undefined) {
    // Unhighlight all blocks.
    for (var i = 0, block; block = this.highlightedBlocks_[i]; i++) {
      block.setHighlighted(false);
    }
    this.highlightedBlocks_.length = 0;
  }
  // Highlight/unhighlight the specified block.
  var block = id ? this.getBlockById(id) : null;
  if (block) {
    var state = (opt_state === undefined) || opt_state;
    // Using Set here would be great, but at the cost of IE10 support.
    if (!state) {
      goog.array.remove(this.highlightedBlocks_, block);
    } else if (this.highlightedBlocks_.indexOf(block) == -1) {
      this.highlightedBlocks_.push(block);
    }
    block.setHighlighted(state);
  }
};

/**
 * Glow/unglow a block in the workspace.
 * @param {?string} id ID of block to find.
 * @param {boolean} isGlowingBlock Whether to glow the block.
 */
Blockly.WorkspaceSvg.prototype.glowBlock = function(id, isGlowingBlock) {
  var block = null;
  if (id) {
    block = this.getBlockById(id);
    if (!block) {
      throw 'Tried to glow block that does not exist.';
    }
  }
  block.setGlowBlock(isGlowingBlock);
};

/**
 * Glow/unglow a stack in the workspace.
 * @param {?string} id ID of block which starts the stack.
 * @param {boolean} isGlowingStack Whether to glow the stack.
 */
Blockly.WorkspaceSvg.prototype.glowStack = function(id, isGlowingStack) {
  var block = null;
  if (id) {
    block = this.getBlockById(id);
    if (!block) {
      throw 'Tried to glow stack on block that does not exist.';
    }
  }
  block.setGlowStack(isGlowingStack);
};

/**
 * Visually report a value associated with a block.
 * In Scratch, appears as a pop-up next to the block when a reporter block is clicked.
 * @param {?string} id ID of block to report associated value.
 * @param {?string} value String value to visually report.
 */
Blockly.WorkspaceSvg.prototype.reportValue = function(id, value) {
  var block = this.getBlockById(id);
  if (!block) {
    throw 'Tried to report value on block that does not exist.';
  }
  Blockly.DropDownDiv.hideWithoutAnimation();
  Blockly.DropDownDiv.clearContent();
  var contentDiv = Blockly.DropDownDiv.getContentDiv();
  var valueReportBox = goog.dom.createElement('div');
  valueReportBox.setAttribute('class', 'valueReportBox');
  valueReportBox.textContent = value;
  contentDiv.appendChild(valueReportBox);
  Blockly.DropDownDiv.setColour(
      Blockly.Colours.valueReportBackground,
      Blockly.Colours.valueReportBorder
  );
  Blockly.DropDownDiv.showPositionedByBlock(this, block);
};

/**
 * Paste the provided block onto the workspace.
 * @param {!Element} xmlBlock XML block element.
 */
Blockly.WorkspaceSvg.prototype.paste = function(xmlBlock) {
  if (!this.rendered) {
    return;
  }
  if (this.currentGesture_) {
    this.currentGesture_.cancel();  // Dragging while pasting?  No.
  }
  if (xmlBlock.tagName.toLowerCase() == 'comment') {
    this.pasteWorkspaceComment_(xmlBlock);
  } else {
    this.pasteBlock_(xmlBlock);
  }
};

/**
 * Paste the provided block onto the workspace.
 * @param {!Element} xmlBlock XML block element.
 */
Blockly.WorkspaceSvg.prototype.pasteBlock_ = function(xmlBlock) {
  Blockly.Events.disable();
  try {
    Blockly.scratchBlocksUtils.changeCopiedBlockIds(xmlBlock);
    var block = Blockly.Xml.domToBlock(xmlBlock, this);
    // Scratch-specific: Give shadow dom new IDs to prevent duplicating on paste
    Blockly.scratchBlocksUtils.changeObscuredShadowIds(block);
    // Move the duplicate to original position.
    var blockX = parseInt(xmlBlock.getAttribute('x'), 10);
    var blockY = parseInt(xmlBlock.getAttribute('y'), 10);
    if (!isNaN(blockX) && !isNaN(blockY)) {
      if (this.RTL) {
        blockX = -blockX;
      }
      // Offset block until not clobbering another block and not in connection
      // distance with neighbouring blocks.
      do {
        var collide = false;
        var allBlocks = this.getAllBlocks();
        for (var i = 0, otherBlock; otherBlock = allBlocks[i]; i++) {
          var otherXY = otherBlock.getRelativeToSurfaceXY();
          if (Math.abs(blockX - otherXY.x) <= 1 &&
              Math.abs(blockY - otherXY.y) <= 1) {
            collide = true;
            break;
          }
        }
        if (!collide) {
          // Check for blocks in snap range to any of its connections.
          var connections = block.getConnections_(false);
          for (var i = 0, connection; connection = connections[i]; i++) {
            var neighbour = connection.closest(Blockly.SNAP_RADIUS,
                new goog.math.Coordinate(blockX, blockY));
            if (neighbour.connection) {
              collide = true;
              break;
            }
          }
        }
        if (collide) {
          if (this.RTL) {
            blockX -= Blockly.SNAP_RADIUS;
          } else {
            blockX += Blockly.SNAP_RADIUS;
          }
          blockY += Blockly.SNAP_RADIUS * 2;
        }
      } while (collide);
      block.moveBy(blockX, blockY);
    }
  } finally {
    Blockly.Events.enable();
  }
  if (Blockly.Events.isEnabled() && !block.isShadow()) {
    Blockly.Events.fire(new Blockly.Events.BlockCreate(block));
  }
  block.select();
};

/**
 * Paste the provided comment onto the workspace.
 * @param {!Element} xmlComment XML workspace comment element.
 * @private
 */
Blockly.WorkspaceSvg.prototype.pasteWorkspaceComment_ = function(xmlComment) {
  Blockly.Events.disable();
  try {
    var comment = Blockly.WorkspaceCommentSvg.fromXml(xmlComment, this);
    // fromXml already positioned the comment at its original location
    // (including RTL handling). Re-applying the stored x/y here would shift it
    // by roughly double the original distance, so just nudge the duplicate by
    // a fixed offset so it doesn't sit exactly on top of the original.
    var offsetX = this.RTL ? -50 : 50;
    comment.moveBy(offsetX, 50);
  } finally {
    Blockly.Events.enable();
  }
  if (Blockly.Events.isEnabled()) {
    Blockly.WorkspaceComment.fireCreateEvent(comment);
  }
  comment.select();
};

/**
 * Refresh the toolbox unless there's a drag in progress.
 * @private
 */
Blockly.WorkspaceSvg.prototype.refreshToolboxSelection_ = function() {
  // Updating the toolbox can be expensive. Don't do it when when it is
  // disabled.
  if (this.toolbox_) {
    if (this.toolbox_.flyout_ && !this.currentGesture_ &&
      this.toolboxRefreshEnabled_) {
      this.toolbox_.refreshSelection();
    }
  } else {
    var thisTarget = this.targetWorkspace;
    if (thisTarget && thisTarget.toolbox_ && thisTarget.toolbox_.flyout_ &&
      !thisTarget.currentGesture_ && thisTarget.toolboxRefreshEnabled_) {
      thisTarget.toolbox_.refreshSelection();
    }
  }
};

/**
 * Rename a variable by updating its name in the variable map.  Update the
 *     flyout to show the renamed variable immediately.
 * @param {string} id ID of the variable to rename.
 * @param {string} newName New variable name.
 * @package
 */
Blockly.WorkspaceSvg.prototype.renameVariableById = function(id, newName) {
  Blockly.WorkspaceSvg.superClass_.renameVariableById.call(this, id, newName);
  this.refreshToolboxSelection_();
};

/**
 * Delete a variable by the passed in ID.   Update the flyout to show
 *     immediately that the variable is deleted.
 * @param {string} id ID of variable to delete.
 * @package
 */
Blockly.WorkspaceSvg.prototype.deleteVariableById = function(id) {
  Blockly.WorkspaceSvg.superClass_.deleteVariableById.call(this, id);
  this.refreshToolboxSelection_();
};

/**
 * Create a new variable with the given name.  Update the flyout to show the new
 *     variable immediately.
 * @param {string} name The new variable's name.
 * @param {string=} opt_type The type of the variable like 'int' or 'string'.
 *     Does not need to be unique. Field_variable can filter variables based on
 *     their type. This will default to '' which is a specific type.
 * @param {string=} opt_id The unique ID of the variable. This will default to
 *     a UUID.
 * @param {boolean=} opt_isLocal Whether the variable is locally scoped.
 * @param {boolean=} opt_isCloud Whether the variable is a cloud variable.
 * @return {?Blockly.VariableModel} The newly created variable.
 * @package
 */
Blockly.WorkspaceSvg.prototype.createVariable = function(name, opt_type, opt_id,
    opt_isLocal, opt_isCloud) {
  var variableInMap = (this.getVariable(name, opt_type) != null);
  var newVar = Blockly.WorkspaceSvg.superClass_.createVariable.call(
      this, name, opt_type, opt_id, opt_isLocal, opt_isCloud);
  // For performance reasons, only refresh the the toolbox for new variables.
  // Variables that already exist should already be there.
  if (!variableInMap && (opt_type != Blockly.BROADCAST_MESSAGE_VARIABLE_TYPE)) {
    this.refreshToolboxSelection_();
  }
  return newVar;
};

/**
 * Update cached areas for this workspace.
 */
Blockly.WorkspaceSvg.prototype.recordCachedAreas = function() {
  this.recordBlocksArea_();
  this.recordDeleteAreas_();
};

/**
 * Make a list of all the delete areas for this workspace.
 * @private
 */
Blockly.WorkspaceSvg.prototype.recordDeleteAreas_ = function() {
  if (this.trashcan) {
    this.deleteAreaTrash_ = this.trashcan.getClientRect();
  } else {
    this.deleteAreaTrash_ = null;
  }
  if (this.flyout_) {
    this.deleteAreaToolbox_ = this.flyout_.getClientRect();
  } else if (this.toolbox_) {
    this.deleteAreaToolbox_ = this.toolbox_.getClientRect();
  } else {
    this.deleteAreaToolbox_ = null;
  }
};

/**
 * Record where all of blocks GUI is on the screen
 * @private
 */
Blockly.WorkspaceSvg.prototype.recordBlocksArea_ = function() {
  var parentSvg = this.getParentSvg();
  if (parentSvg) {
    var bounds = parentSvg.getBoundingClientRect();
    this.blocksArea_ = new goog.math.Rect(bounds.left, bounds.top, bounds.width, bounds.height);
  } else {
    this.blocksArea_ = null;
  }
};

/**
 * Is the mouse event over a delete area (toolbox or non-closing flyout)?
 * @param {!Event} e Mouse move event.
 * @return {?number} Null if not over a delete area, or an enum representing
 *     which delete area the event is over.
 */
Blockly.WorkspaceSvg.prototype.isDeleteArea = function(e) {
  var xy = new goog.math.Coordinate(e.clientX, e.clientY);
  if (this.deleteAreaTrash_ && this.deleteAreaTrash_.contains(xy)) {
    return Blockly.DELETE_AREA_TRASH;
  }
  if (this.deleteAreaToolbox_ && this.deleteAreaToolbox_.contains(xy)) {
    return Blockly.DELETE_AREA_TOOLBOX;
  }
  return Blockly.DELETE_AREA_NONE;
};

/**
 * Is the mouse event inside the blocks UI?
 * @param {!Event} e Mouse move event.
 * @return {boolean} True if event is within the bounds of the blocks UI or delete area
 */
Blockly.WorkspaceSvg.prototype.isInsideBlocksArea = function(e) {
  var xy = new goog.math.Coordinate(e.clientX, e.clientY);
  if (this.isDeleteArea(e) || (this.blocksArea_ && this.blocksArea_.contains(xy))) {
    return true;
  }
  return false;
};

/**
 * Handle a mouse-down on SVG drawing surface.
 * @param {!Event} e Mouse down event.
 * @private
 */
Blockly.WorkspaceSvg.prototype.onMouseDown_ = function(e) {
  var gesture = this.getGesture(e);
  if (gesture) {
    gesture.handleWsStart(e, this);
  }
};

/**
 * Start tracking a drag of an object on this workspace.
 * @param {!Event} e Mouse down event.
 * @param {!goog.math.Coordinate} xy Starting location of object.
 */
Blockly.WorkspaceSvg.prototype.startDrag = function(e, xy) {
  // Record the starting offset between the bubble's location and the mouse.
  var point = Blockly.utils.mouseToSvg(e, this.getParentSvg(),
      this.getInverseScreenCTM());
  // Fix scale of mouse event.
  point.x /= this.scale;
  point.y /= this.scale;
  this.dragDeltaXY_ = goog.math.Coordinate.difference(xy, point);
};

/**
 * Track a drag of an object on this workspace.
 * @param {!Event} e Mouse move event.
 * @return {!goog.math.Coordinate} New location of object.
 */
Blockly.WorkspaceSvg.prototype.moveDrag = function(e) {
  var point = Blockly.utils.mouseToSvg(e, this.getParentSvg(),
      this.getInverseScreenCTM());
  // Fix scale of mouse event.
  point.x /= this.scale;
  point.y /= this.scale;
  return goog.math.Coordinate.sum(this.dragDeltaXY_, point);
};

/**
 * Is the user currently dragging a block or scrolling the flyout/workspace?
 * @return {boolean} True if currently dragging or scrolling.
 */
Blockly.WorkspaceSvg.prototype.isDragging = function() {
  return this.currentGesture_ && this.currentGesture_.isDragging();
};

/**
 * Is this workspace draggable and scrollable?
 * @return {boolean} True if this workspace may be dragged.
 */
Blockly.WorkspaceSvg.prototype.isDraggable = function() {
  return !!this.scrollbar;
};

/**
 * Handle a mouse-wheel on SVG drawing surface.
 * @param {!Event} e Mouse wheel event.
 * @private
 */
Blockly.WorkspaceSvg.prototype.onMouseWheel_ = function(e) {
  // TODO: Remove gesture cancellation and compensate for coordinate skew during
  // zoom.
  if (this.currentGesture_) {
    this.currentGesture_.cancel();
  }

  // Multiplier variable, so that non-pixel-deltaModes are supported.
  // See LLK/scratch-blocks#1190.
  var multiplier = e.deltaMode === 0x1 ? Blockly.LINE_SCROLL_MULTIPLIER : 1;

  if (e.ctrlKey) {
    // The vertical scroll distance that corresponds to a click of a zoom button.
    var PIXELS_PER_ZOOM_STEP = 50;
    var delta = -e.deltaY / PIXELS_PER_ZOOM_STEP * multiplier;
    // Coalesce wheel/pinch zoom events into one zoom per animation frame.
    // Every zoom() call runs two getCTM() forced layouts (workspace_svg.js
    // zoom:1991,2008) plus a full scrollbar resize chain, so a 120 Hz
    // trackpad burst was paying that per event. Deltas accumulate and the
    // anchor is the latest cursor position, which is what a continuous
    // pinch feels like anyway. Mirrors the scroll coalescing below.
    // (2026-10-17)
    this.pendingZoomDelta_ = (this.pendingZoomDelta_ || 0) + delta;
    this.pendingZoomClientX_ = e.clientX;
    this.pendingZoomClientY_ = e.clientY;
    if (!this.zoomRafScheduled_) {
      this.zoomRafScheduled_ = true;
      var ws = this;
      this.zoomRafId_ = requestAnimationFrame(function() {
        ws.zoomRafScheduled_ = false;
        ws.zoomRafId_ = null;
        var amount = ws.pendingZoomDelta_ || 0;
        ws.pendingZoomDelta_ = 0;
        if (amount) {
          var position = Blockly.utils.mouseToSvg(
              {clientX: ws.pendingZoomClientX_, clientY: ws.pendingZoomClientY_},
              ws.getParentSvg(), ws.getInverseScreenCTM());
          ws.zoom(position.x, position.y, amount);
        }
      });
    }
  } else {
    // This is a regular mouse wheel event - scroll the workspace
    // First hide the WidgetDiv without animation
    // (mouse scroll makes field out of place with div)
    Blockly.WidgetDiv.hide(true);
    Blockly.DropDownDiv.hideWithoutAnimation();

    // Coalesce wheel/trackpad events into one scroll per animation frame so
    // high-frequency wheel storms don't thrash the scrollbar. (2026-08-28)
    this.pendingScrollDeltaX_ = (this.pendingScrollDeltaX_ || 0) +
        (e.deltaX * multiplier);
    this.pendingScrollDeltaY_ = (this.pendingScrollDeltaY_ || 0) +
        (e.deltaY * multiplier);
    this.pendingScrollShift_ = e.shiftKey;
    if (!this.wheelRafScheduled_) {
      this.wheelRafScheduled_ = true;
      var self = this;
      this.wheelRafId_ = requestAnimationFrame(function() {
        self.wheelRafScheduled_ = false;
        self.wheelRafId_ = null;
        var dx = self.pendingScrollDeltaX_ || 0;
        var dy = self.pendingScrollDeltaY_ || 0;
        self.pendingScrollDeltaX_ = 0;
        self.pendingScrollDeltaY_ = 0;
        var scrollX = self.scrollX - dx;
        var scrollY = self.scrollY - dy;
        if (self.pendingScrollShift_ && dx === 0) {
          // Scroll horizontally (based on vertical scroll delta)
          // This is needed as for some browser/system combinations which do not
          // set deltaX. See #1662.
          scrollX = self.scrollX - dy;
          scrollY = self.scrollY; // Don't scroll vertically
        }
        self.startDragMetrics = self.getMetrics();
        self.scroll(scrollX, scrollY);
      });
    }
  }
  e.preventDefault();
};

/**
 * Distance between the first two touches of a touch event, in pixels.
 * @param {!TouchEvent} e Touch event with at least two touches.
 * @return {number} Distance between the touches.
 * @private
 */
Blockly.WorkspaceSvg.touchDistance_ = function(e) {
  var dx = e.touches[0].clientX - e.touches[1].clientX;
  var dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Midpoint between the first two touches of a touch event, in client pixels.
 * @param {!TouchEvent} e Touch event with at least two touches.
 * @return {{clientX: number, clientY: number}} Midpoint of the touches.
 * @private
 */
Blockly.WorkspaceSvg.touchMidpoint_ = function(e) {
  return {
    clientX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
    clientY: (e.touches[0].clientY + e.touches[1].clientY) / 2
  };
};

/**
 * Start listening for two-finger pinch gestures over this workspace.
 *
 * A pinch has to win over the gesture that the first finger starts, and it has
 * to be able to preventDefault() (otherwise the browser page-zooms instead), so
 * the listeners sit on the document in the capture phase and only act on
 * touches that landed inside this workspace's canvas.
 * @private
 */
Blockly.WorkspaceSvg.prototype.initPinchZoom_ = function() {
  if (!this.options.zoomOptions || this.pinchListeners_.length) {
    return;
  }
  var workspace = this;

  var isInsideWorkspace = function(e) {
    return !!(workspace.svgGroup_ && workspace.svgGroup_.contains(e.target));
  };

  var onStart = function(e) {
    if (e.touches.length < 2 || !isInsideWorkspace(e)) {
      return;
    }
    workspace.beginPinch_(e);
    e.preventDefault();
    e.stopPropagation();
  };

  var onMove = function(e) {
    if (!workspace.pinch_) {
      // The second finger may have arrived without a touchstart we saw.
      if (e.touches.length < 2 || !isInsideWorkspace(e)) {
        return;
      }
      workspace.beginPinch_(e);
    } else if (e.touches.length < 2) {
      // A finger was lifted mid-pinch; stop rather than jumping.
      workspace.endPinch_();
      e.preventDefault();
      e.stopPropagation();
      return;
    } else {
      workspace.updatePinch_(e);
    }
    e.preventDefault();
    e.stopPropagation();
  };

  var onEnd = function(e) {
    if (!workspace.pinch_) {
      return;
    }
    if (e.touches.length >= 2) {
      // One finger was replaced by another: continue from the new pair.
      workspace.pinch_.distance = Blockly.WorkspaceSvg.touchDistance_(e);
      workspace.pinch_.scale = workspace.scale;
      return;
    }
    workspace.endPinch_();
  };

  var listeners = [
    ['touchstart', onStart],
    ['touchmove', onMove],
    ['touchend', onEnd],
    ['touchcancel', onEnd]
  ];
  for (var i = 0; i < listeners.length; i++) {
    var type = listeners[i][0];
    var func = listeners[i][1];
    // Not passive: a pinch that cannot preventDefault() would be turned into a
    // browser page zoom instead of a workspace zoom.
    document.addEventListener(type, func, {capture: true, passive: false});
    this.pinchListeners_.push([type, func]);
  }
};

/**
 * Begin a pinch: the view is about to be scaled by the distance between two
 * fingers, so anything the first finger started dragging has to be dropped.
 * @param {!TouchEvent} e Touch event that started the pinch.
 * @private
 */
Blockly.WorkspaceSvg.prototype.beginPinch_ = function(e) {
  this.cancelCurrentGesture();
  Blockly.longStop_();
  // Let the next touch start a fresh gesture.
  Blockly.Touch.clearTouchIdentifier();
  Blockly.WidgetDiv.hide(true);
  Blockly.DropDownDiv.hideWithoutAnimation();
  this.pinch_ = {
    distance: Blockly.WorkspaceSvg.touchDistance_(e),
    scale: this.scale,
    targetScale: this.scale
  };
};

/**
 * Update the zoom target of a pinch in progress.
 * @param {!TouchEvent} e Touch event of the move.
 * @private
 */
Blockly.WorkspaceSvg.prototype.updatePinch_ = function(e) {
  var pinch = this.pinch_;
  var distance = Blockly.WorkspaceSvg.touchDistance_(e);
  if (!pinch.distance || !distance) {
    return;
  }
  var zoomOptions = this.options.zoomOptions;
  var target = pinch.scale * (distance / pinch.distance);
  if (zoomOptions.maxScale) {
    target = Math.min(target, zoomOptions.maxScale);
  }
  if (zoomOptions.minScale) {
    target = Math.max(target, zoomOptions.minScale);
  }
  pinch.targetScale = target;
  var midpoint = Blockly.WorkspaceSvg.touchMidpoint_(e);
  pinch.clientX = midpoint.clientX;
  pinch.clientY = midpoint.clientY;

  // One zoom per animation frame: zoom() costs two forced layouts plus a full
  // scrollbar resize chain, and a pinch reports at least as often as that.
  if (!this.pinchRafScheduled_) {
    this.pinchRafScheduled_ = true;
    var self = this;
    this.pinchRafId_ = requestAnimationFrame(function() {
      self.pinchRafScheduled_ = false;
      self.pinchRafId_ = null;
      self.applyPinchZoom_();
    });
  }
};

/**
 * Scale the view to the zoom a pinch has asked for, around the point between
 * the two fingers.
 * @private
 */
Blockly.WorkspaceSvg.prototype.applyPinchZoom_ = function() {
  var pinch = this.pinch_;
  if (!pinch) {
    return;
  }
  var ratio = pinch.targetScale / this.scale;
  if (!isFinite(ratio) || Math.abs(ratio - 1) < 0.0001) {
    return;
  }
  var speed = this.options.zoomOptions.scaleSpeed || 1.2;
  var position = Blockly.utils.mouseToSvg(
      {clientX: pinch.clientX, clientY: pinch.clientY},
      this.getParentSvg(), this.getInverseScreenCTM());
  // zoom() counts in steps of scaleSpeed, so convert the wanted ratio into
  // (possibly fractional) steps.
  this.zoom(position.x, position.y, Math.log(ratio) / Math.log(speed));
};

/**
 * End a pinch and let the next touch start a new gesture.
 * @private
 */
Blockly.WorkspaceSvg.prototype.endPinch_ = function() {
  this.pinch_ = null;
  if (this.pinchRafScheduled_ && this.pinchRafId_) {
    window.cancelAnimationFrame(this.pinchRafId_);
  }
  this.pinchRafScheduled_ = false;
  this.pinchRafId_ = null;
  Blockly.Touch.clearTouchIdentifier();
};

/**
 * PATCH 9 (2026-10-10): drop the cached content bounding box.
 * Call from anything that can change the set of top blocks/comments, their
 * workspace coordinates, or their rendered height/width.
 * @private
 */
Blockly.WorkspaceSvg.prototype.invalidateContentBounds_ = function(opt_element) {
  this.contentBoundingBoxDirty_ = true;
  // PATCH 12 (2026-10-10): lazily create the per-element rectangle bookkeeping.
  // Keeping it lazy means no constructor initialisation is needed.
  if (!this.contentRectDirty_) {
    this.contentRectDirty_ = new Set();
    if (!this.contentRectCache_) {
      this.contentRectCache_ = new Map();
    }
  }
  if (opt_element && !this.contentRectAllDirty_) {
    // PATCH 12: only this top element's rectangle is stale. Re-measuring one
    // stack is what takes a per-keystroke field edit from O(all stacks) to
    // O(one stack).
    this.contentRectDirty_.add(opt_element);
  } else {
    // Unknown, or a caller that can affect anything: re-seed from scratch.
    this.contentRectAllDirty_ = true;
    this.contentRectDirty_.clear();
  }
  if (this.intersectionObserver) {
    // PATCH 11 (2026-10-10): the intersection observer caches per-block rects
    // off this same signal, because that geometry too only changes with content.
    this.intersectionObserver.contentDirty_ = true;
  }
};

/**
 * PATCH 12 (2026-10-10): refresh the per-top-element rectangle table.
 *
 * getBlocksBoundingBox() unions this table and the IntersectionObserver culls
 * from it, so the two of them can never disagree about where a stack is.
 * Re-measures only the elements flagged by invalidateContentBounds_(element);
 * a full re-seed happens when the set of top elements itself changed. Cheap and
 * idempotent, so calling it from more than one consumer in the same frame costs
 * nothing after the first call.
 * @private
 */
Blockly.WorkspaceSvg.prototype.refreshContentRects_ = function() {
  if (!this.contentRectCache_) {
    this.contentRectCache_ = new Map();
    this.contentRectDirty_ = new Set();
    this.contentRectAllDirty_ = true;
  } else if (!this.contentRectDirty_) {
    this.contentRectDirty_ = new Set();
  }

  var topCount = this.topBlocks_.length + this.topComments_.length;
  var cache = this.contentRectCache_;
  if (this.contentRectAllDirty_ || this.contentRectSetDirty_ ||
      cache.size !== topCount) {
    // A stale count means a top element appeared or vanished outside of an
    // element-level invalidation.
    var topElements = this.getTopBlocks(false).concat(this.getTopComments(false));
    if (this.contentRectAllDirty_) {
      // Unknown scope: nothing can be trusted, re-seed everything.
      cache.clear();
      this.contentRectDirty_.clear();
      for (var i = 0; i < topElements.length; i++) {
        this.contentRectDirty_.add(topElements[i]);
      }
    } else {
      // PATCH 13 (2026-10-10): reconcile instead of re-seeding. A stack that
      // appeared or vanished says nothing about the stacks around it, so only
      // the newcomers get measured. Deleting one block used to make every stack
      // in the workspace re-measure, which is what made deletion (and the block
      // a flyout drag adds) cost O(all blocks).
      var present = new Set();
      for (var j = 0; j < topElements.length; j++) {
        present.add(topElements[j]);
      }
      // Drop table entries whose element is gone.
      var gone = [];
      cache.forEach(function(rect, element) {
        if (!present.has(element)) {
          gone.push(element);
        }
      });
      for (var k = 0; k < gone.length; k++) {
        cache.delete(gone[k]);
      }
      // A disposed block can still be sitting in the dirty set; keep only live
      // elements there, then flag every newcomer that has no rectangle yet.
      var liveDirty = new Set();
      this.contentRectDirty_.forEach(function(element) {
        if (present.has(element)) {
          liveDirty.add(element);
        }
      });
      this.contentRectDirty_ = liveDirty;
      for (var m = 0; m < topElements.length; m++) {
        if (!cache.has(topElements[m])) {
          this.contentRectDirty_.add(topElements[m]);
        }
      }
    }
    this.contentRectAllDirty_ = false;
    this.contentRectSetDirty_ = false;
  } else if (this.contentRectDirty_.size === 0) {
    return;
  }

  this.contentRectDirty_.forEach(function(element) {
    // PATCH 18 (2026-10-11): a disposed element can still be flagged dirty --
    // dispose() marks its stack, and an add plus a removal in the same frame can
    // leave the top-element count unchanged, which skips the reconcile pass that
    // filters dead entries. Measuring it throws, because
    // getBoundingRectangle() -> getRelativeToSurfaceXY() dereferences the
    // workspace link dispose() already cleared.
    if (!element.workspace) {
      cache.delete(element);
      return;
    }
    var rect = element.getBoundingRectangle();
    cache.set(element, {
      left: rect.topLeft.x,
      top: rect.topLeft.y,
      width: rect.bottomRight.x - rect.topLeft.x,
      height: rect.bottomRight.y - rect.topLeft.y
    });
  });
  this.contentRectDirty_.clear();
};

/**
 * Calculate the bounding box for the blocks on the workspace.
 * Coordinate system: workspace coordinates.
 *
 * @return {Object} Contains the position and size of the bounding box
 *   containing the blocks on the workspace.
 */
Blockly.WorkspaceSvg.prototype.getBlocksBoundingBox = function() {
  var count = this.topBlocks_.length + this.topComments_.length;
  // PATCH 9 (2026-10-10): serve the cached box while content is unchanged.
  // Callers only read the result, but hand out a copy so nothing can mutate the
  // cache. Copying four numbers beats re-walking every stack by a wide margin.
  if (!this.contentBoundingBoxDirty_ && this.contentBoundingBox_ &&
      this.contentBoundingBoxCount_ === count) {
    var cached = this.contentBoundingBox_;
    return {
      x: cached.x, y: cached.y, width: cached.width, height: cached.height
    };
  }

  // PATCH 12 (2026-10-10): the number of top elements changed, so the cached
  // per-element rectangles no longer describe the same set.
  // PATCH 13 (2026-10-10): reconcile the table rather than re-seed it -- the
  // surviving stacks did not move, so only the added/removed ones cost anything.
  if (this.contentBoundingBoxCount_ !== count) {
    this.contentRectSetDirty_ = true;
  }
  // PATCH 12: only the stacks flagged since the last call are re-measured.
  this.refreshContentRects_();

  var cache = this.contentRectCache_;
  // There are no blocks, return empty rectangle.
  if (!cache || cache.size === 0) {
    this.contentBoundingBox_ = {x: 0, y: 0, width: 0, height: 0};
    this.contentBoundingBoxDirty_ = false;
    this.contentBoundingBoxCount_ = 0;
    return {x: 0, y: 0, width: 0, height: 0};
  }

  // Union the per-element rectangles. O(top elements) of pure arithmetic.
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  cache.forEach(function(rect) {
    if (rect.left < minX) {
      minX = rect.left;
    }
    if (rect.top < minY) {
      minY = rect.top;
    }
    if (rect.left + rect.width > maxX) {
      maxX = rect.left + rect.width;
    }
    if (rect.top + rect.height > maxY) {
      maxY = rect.top + rect.height;
    }
  });

  // PATCH 9 (2026-10-10): memoize. Pan/zoom never reaches this branch, because
  // it only mutates the canvas transform and never the content, so all frames
  // between two content changes are served from the cache above.
  this.contentBoundingBox_ = {
    x: minX, y: minY, width: maxX - minX, height: maxY - minY
  };
  this.contentBoundingBoxDirty_ = false;
  this.contentBoundingBoxCount_ = count;
  var box = this.contentBoundingBox_;
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height
  };
};

/**
 * Clean up the workspace by ordering all the blocks in a column.
 */
Blockly.WorkspaceSvg.prototype.cleanUp = function() {
  this.setResizesEnabled(false);
  Blockly.Events.setGroup(true);
  var topBlocks = this.getTopBlocks(true);
  var cursorY = 0;
  for (var i = 0, block; block = topBlocks[i]; i++) {
    var xy = block.getRelativeToSurfaceXY();
    block.moveBy(-xy.x, cursorY - xy.y);
    block.snapToGrid();
    cursorY = block.getRelativeToSurfaceXY().y +
        block.getHeightWidth().height + Blockly.BlockSvg.MIN_BLOCK_Y;
  }
  Blockly.Events.setGroup(false);
  this.setResizesEnabled(true);
};

/**
 * Show the context menu for the workspace.
 * @param {!Event} e Mouse event.
 * @private
 */
Blockly.WorkspaceSvg.prototype.showContextMenu_ = function(e) {
  if (this.options.readOnly || this.isFlyout) {
    return;
  }
  var menuOptions = [];
  var topBlocks = this.getTopBlocks(true);
  var eventGroup = Blockly.utils.genUid();
  var ws = this;

  // Options to undo/redo previous action.
  menuOptions.push(Blockly.ContextMenu.wsUndoOption(this));
  menuOptions.push(Blockly.ContextMenu.wsRedoOption(this));

  // Option to clean up blocks.
  if (this.scrollbar) {
    menuOptions.push(
        Blockly.ContextMenu.wsCleanupOption(this,topBlocks.length));
  }

  if (this.options.collapse) {
    var hasCollapsedBlocks = false;
    var hasExpandedBlocks = false;
    for (var i = 0; i < topBlocks.length; i++) {
      var block = topBlocks[i];
      while (block) {
        if (block.isCollapsed()) {
          hasCollapsedBlocks = true;
        } else {
          hasExpandedBlocks = true;
        }
        block = block.getNextBlock();
      }
    }

    menuOptions.push(Blockly.ContextMenu.wsCollapseOption(hasExpandedBlocks,
        topBlocks));

    menuOptions.push(Blockly.ContextMenu.wsExpandOption(hasCollapsedBlocks,
        topBlocks));
  }

  // Option to add a workspace comment.
  if (this.options.comments) {
    menuOptions.push(Blockly.ContextMenu.workspaceCommentOption(ws, e));
  }

  // Option to delete all blocks.
  // Count the number of blocks that are deletable.
  var deleteList = Blockly.WorkspaceSvg.buildDeleteList_(topBlocks);
  // Scratch-specific: don't count shadow blocks in delete count
  var deleteCount = 0;
  for (var i = 0; i < deleteList.length; i++) {
    if (!deleteList[i].isShadow()) {
      deleteCount++;
    }
  }

  var DELAY = 10;
  function deleteNext() {
    Blockly.Events.setGroup(eventGroup);
    var block = deleteList.shift();
    if (block) {
      if (block.workspace) {
        block.dispose(false, true);
        setTimeout(deleteNext, DELAY);
      } else {
        deleteNext();
      }
    }
    Blockly.Events.setGroup(false);
  }

  var deleteOption = {
    text: deleteCount == 1 ? Blockly.Msg.DELETE_BLOCK :
        Blockly.Msg.DELETE_X_BLOCKS.replace('%1', String(deleteCount)),
    enabled: deleteCount > 0,
    callback: function() {
      if (ws.currentGesture_) {
        ws.currentGesture_.cancel();
      }
      if (deleteCount < 2 ) {
        deleteNext();
      } else {
        Blockly.confirm(
            Blockly.Msg.DELETE_ALL_BLOCKS.replace('%1', String(deleteCount)),
            function(ok) {
              if (ok) {
                deleteNext();
              }
            });
      }
    }
  };
  menuOptions.push(deleteOption);

  Blockly.ContextMenu.show(e, menuOptions, this.RTL);
};

/**
 * Build a list of all deletable blocks that are reachable from the given
 * list of top blocks.
 * @param {!Array.<!Blockly.BlockSvg>} topBlocks The list of top blocks on the
 *     workspace.
 * @return {!Array.<!Blockly.BlockSvg>} A list of deletable blocks on the
 *     workspace.
 * @private
 */
Blockly.WorkspaceSvg.buildDeleteList_ = function(topBlocks) {
  var deleteList = [];
  function addDeletableBlocks(block) {
    if (block.isDeletable()) {
      deleteList = deleteList.concat(block.getDescendants(false));
    } else {
      var children = block.getChildren();
      for (var i = 0; i < children.length; i++) {
        addDeletableBlocks(children[i]);
      }
    }
  }
  for (var i = 0; i < topBlocks.length; i++) {
    addDeletableBlocks(topBlocks[i]);
  }
  return deleteList;
};

/**
 * Modify the block tree on the existing toolbox.
 * @param {Node|string} tree DOM tree of blocks, or text representation of same.
 */
Blockly.WorkspaceSvg.prototype.updateToolbox = function(tree) {
  tree = Blockly.Options.parseToolboxTree(tree);
  if (!tree) {
    if (this.options.languageTree) {
      throw 'Can\'t nullify an existing toolbox.';
    }
    return;  // No change (null to null).
  }
  if (!this.options.languageTree) {
    throw 'Existing toolbox is null.  Can\'t create new toolbox.';
  }
  if (tree.getElementsByTagName('category').length) {
    if (!this.toolbox_) {
      throw 'Existing toolbox has no categories.  Can\'t change mode.';
    }
    this.options.languageTree = tree;
    this.toolbox_.populate_(tree);
    this.toolbox_.position();
  } else {
    if (!this.flyout_) {
      throw 'Existing toolbox has categories.  Can\'t change mode.';
    }
    this.options.languageTree = tree;
    this.flyout_.show(tree.childNodes);
  }
};

/**
 * Mark this workspace as the currently focused main workspace.
 */
Blockly.WorkspaceSvg.prototype.markFocused = function() {
  if (this.options.parentWorkspace) {
    this.options.parentWorkspace.markFocused();
  } else {
    Blockly.mainWorkspace = this;
    // We call e.preventDefault in many event handlers which means we
    // need to explicitly grab focus (e.g from a textarea) because
    // the browser will not do it for us.  How to do this is browser dependant.
    this.setBrowserFocus();
  }
};

/**
 * Set the workspace to have focus in the browser.
 * @private
 */
Blockly.WorkspaceSvg.prototype.setBrowserFocus = function() {
  // Blur whatever was focused since explcitly grabbing focus below does not
  // work in Edge.
  if (document.activeElement) {
    document.activeElement.blur();
  }
  try {
    // Focus the workspace SVG - this is for Chrome and Firefox.
    this.getParentSvg().focus();
  }  catch (e) {
    // IE and Edge do not support focus on SVG elements. When that fails
    // above, get the injectionDiv (the workspace's parent) and focus that
    // instead.  This doesn't work in Chrome.
    try {
      // In IE11, use setActive (which is IE only) so the page doesn't scroll
      // to the workspace gaining focus.
      this.getParentSvg().parentNode.setActive();
    } catch (e) {
      // setActive support was discontinued in Edge so when that fails, call
      // focus instead.
      this.getParentSvg().parentNode.focus();
    }
  }
};

/**
 * Zooming the blocks centered in (x, y) coordinate with zooming in or out.
 * @param {number} x X coordinate of center.
 * @param {number} y Y coordinate of center.
 * @param {number} amount Amount of zooming
 *                        (negative zooms out and positive zooms in).
 */
Blockly.WorkspaceSvg.prototype.zoom = function(x, y, amount) {
  var speed = this.options.zoomOptions.scaleSpeed;
  var metrics = this.getMetrics();
  var center = this.getParentSvg().createSVGPoint();
  center.x = x;
  center.y = y;
  center = center.matrixTransform(this.getCanvas().getCTM().inverse());
  x = center.x;
  y = center.y;
  var canvas = this.getCanvas();
  // Scale factor.
  var scaleChange = Math.pow(speed, amount);
  // Clamp scale within valid range.
  var newScale = this.scale * scaleChange;
  if (newScale > this.options.zoomOptions.maxScale) {
    scaleChange = this.options.zoomOptions.maxScale / this.scale;
  } else if (newScale < this.options.zoomOptions.minScale) {
    scaleChange = this.options.zoomOptions.minScale / this.scale;
  }
  if (this.scale == newScale) {
    return;  // No change in zoom.
  }
  if (this.scrollbar) {
    var matrix = canvas.getCTM()
        .translate(x * (1 - scaleChange), y * (1 - scaleChange))
        .scale(scaleChange);
    // newScale and matrix.a should be identical (within a rounding error).
    // ScrollX and scrollY are in pixels.
    this.scrollX = matrix.e - metrics.absoluteLeft;
    this.scrollY = matrix.f - metrics.absoluteTop;
  }
  this.setScale(newScale);
  // Hide the WidgetDiv without animation (zoom makes field out of place with div)
  Blockly.WidgetDiv.hide(true);
  Blockly.DropDownDiv.hideWithoutAnimation();
};

/**
 * Zooming the blocks centered in the center of view with zooming in or out.
 * @param {number} type Type of zooming (-1 zooming out and 1 zooming in).
 */
Blockly.WorkspaceSvg.prototype.zoomCenter = function(type) {
  var metrics = this.getMetrics();
  var x = metrics.viewWidth / 2;
  var y = metrics.viewHeight / 2;
  this.zoom(x, y, type);
};

/**
 * Zoom the blocks to fit in the workspace if possible.
 */
Blockly.WorkspaceSvg.prototype.zoomToFit = function() {
  var metrics = this.getMetrics();
  var blocksBox = this.getBlocksBoundingBox();
  var blocksWidth = blocksBox.width;
  var blocksHeight = blocksBox.height;
  if (!blocksWidth) {
    return;  // Prevents zooming to infinity.
  }
  var workspaceWidth = metrics.viewWidth;
  var workspaceHeight = metrics.viewHeight;
  if (this.flyout_) {
    workspaceWidth -= this.flyout_.width_;
  }
  if (!this.scrollbar) {
    // Origin point of 0,0 is fixed, blocks will not scroll to center.
    blocksWidth += metrics.contentLeft;
    blocksHeight += metrics.contentTop;
  }
  var ratioX = workspaceWidth / blocksWidth;
  var ratioY = workspaceHeight / blocksHeight;
  this.setScale(Math.min(ratioX, ratioY));
  this.scrollCenter();
};

/**
 * Center the workspace.
 */
Blockly.WorkspaceSvg.prototype.scrollCenter = function() {
  if (!this.scrollbar) {
    // Can't center a non-scrolling workspace.
    console.warn('Tried to scroll a non-scrollable workspace.');
    return;
  }
  // Hide the WidgetDiv without animation (zoom makes field out of place with div)
  Blockly.WidgetDiv.hide(true);
  Blockly.DropDownDiv.hideWithoutAnimation();
  Blockly.hideChaff(false);
  var metrics = this.getMetrics();
  var x = (metrics.contentWidth - metrics.viewWidth) / 2;
  if (this.flyout_) {
    x -= this.flyout_.width_ / 2;
  }
  var y = (metrics.contentHeight - metrics.viewHeight) / 2;
  this.scrollbar.set(x, y);
};

/**
 * Scroll the workspace to center on the given block.
 * @param {?string} id ID of block center on.
 * @public
 */
Blockly.WorkspaceSvg.prototype.centerOnBlock = function(id) {
  if (!this.scrollbar) {
    console.warn('Tried to scroll a non-scrollable workspace.');
    return;
  }

  var block = this.getBlockById(id);
  if (!block) {
    return;
  }

  // XY is in workspace coordinates.
  var xy = block.getRelativeToSurfaceXY();
  // Height/width is in workspace units.
  var heightWidth = block.getHeightWidth();

  // Find the enter of the block in workspace units.
  var blockCenterY = xy.y + heightWidth.height / 2;

  // In RTL the block's position is the top right of the block, not top left.
  var multiplier = this.RTL ? -1 : 1;
  var blockCenterX = xy.x + (multiplier * heightWidth.width / 2);

  // Workspace scale, used to convert from workspace coordinates to pixels.
  var scale = this.scale;

  // Center in pixels.  0, 0 is at the workspace origin.  These numbers may
  // be negative.
  var pixelX = blockCenterX * scale;
  var pixelY = blockCenterY * scale;

  var metrics = this.getMetrics();

  // Scrolling to here would put the block in the top-left corner of the
  // visible workspace.
  var scrollToBlockX = pixelX - metrics.contentLeft;
  var scrollToBlockY = pixelY - metrics.contentTop;

  // viewHeight and viewWidth are in pixels.
  var halfViewWidth = metrics.viewWidth / 2;
  var halfViewHeight = metrics.viewHeight / 2;

  // Put the block in the center of the visible workspace instead.
  var scrollToCenterX = scrollToBlockX - halfViewWidth;
  var scrollToCenterY = scrollToBlockY - halfViewHeight;

  Blockly.hideChaff();
  this.scrollbar.set(scrollToCenterX, scrollToCenterY);
};

/**
 * Set the workspace's zoom factor.
 * @param {number} newScale Zoom factor.
 */
Blockly.WorkspaceSvg.prototype.setScale = function(newScale) {
  if (this.options.zoomOptions.maxScale &&
      newScale > this.options.zoomOptions.maxScale) {
    newScale = this.options.zoomOptions.maxScale;
  } else if (this.options.zoomOptions.minScale &&
      newScale < this.options.zoomOptions.minScale) {
    newScale = this.options.zoomOptions.minScale;
  }
  this.scale = newScale;
  if (this.grid_) {
    this.grid_.update(this.scale);
  }
  if (this.scrollbar) {
    this.scrollbar.resize();
  } else {
    this.translate(this.scrollX, this.scrollY);
  }
  Blockly.hideChaff(false);
  if (this.flyout_) {
    // No toolbox, resize flyout.
    this.flyout_.reflow();
  }
  this.queueIntersectionCheck();
};

/**
 * Scroll the workspace by a specified amount, keeping in the bounds.
 * Be sure to set this.startDragMetrics with cached metrics before calling.
 * @param {number} x Target X to scroll to
 * @param {number} y Target Y to scroll to
 */
Blockly.WorkspaceSvg.prototype.scroll = function(x, y) {
  // Use LIVE metrics, not a cached startDragMetrics. The cached snapshot goes
  // stale when content bounds change (e.g. a workspace comment is added or
  // removed), which produced wrong clamping -> pan jump on first frame and
  // incorrect zoom/centerOnBlock. (2026-08-28)
  var metrics = this.getMetrics();
  x = Math.min(x, -metrics.contentLeft);
  y = Math.min(y, -metrics.contentTop);
  x = Math.max(x, metrics.viewWidth - metrics.contentLeft -
               metrics.contentWidth);
  y = Math.max(y, metrics.viewHeight - metrics.contentTop -
               metrics.contentHeight);
  // When the workspace starts scrolling, hide the WidgetDiv without animation.
  // This is to prevent a dispoal animation from happening in the wrong location.
  Blockly.WidgetDiv.hide(true);
  Blockly.DropDownDiv.hideWithoutAnimation();
  // Move the scrollbars and the page will scroll automatically.
  this.scrollbar.set(-x - metrics.contentLeft, -y - metrics.contentTop);
};

/**
 * Update the workspace's stack glow radius to be proportional to scale.
 * Ensures that stack glows always appear to be a fixed size.
 */
Blockly.WorkspaceSvg.prototype.updateStackGlowScale_ = function() {
  // No such def in the flyout workspace.
  if (this.options.stackGlowBlur) {
    this.options.stackGlowBlur.setAttribute('stdDeviation',
        Blockly.Colours.stackGlowSize / this.scale);
  }
};

/**
 * Get the dimensions of the given workspace component, in pixels.
 * @param {Blockly.Toolbox|Blockly.Flyout} elem The element to get the
 *     dimensions of, or null.  It should be a toolbox or flyout, and should
 *     implement getWidth() and getHeight().
 * @return {!Object} An object containing width and height attributes, which
 *     will both be zero if elem did not exist.
 * @private
 */
Blockly.WorkspaceSvg.getDimensionsPx_ = function(elem) {
  var width = 0;
  var height = 0;
  if (elem) {
    width = elem.getWidth();
    height = elem.getHeight();
  }
  return {
    width: width,
    height: height
  };
};

/**
 * Get the content dimensions of the given workspace, taking into account
 * whether or not it is scrollable and what size the workspace div is on screen.
 * @param {!Blockly.WorkspaceSvg} ws The workspace to measure.
 * @param {!Object} svgSize An object containing height and width attributes in
 *     CSS pixels.  Together they specify the size of the visible workspace, not
 *     including areas covered up by the toolbox.
 * @return {!Object} The dimensions of the contents of the given workspace, as
 *     an object containing at least
 *     - height and width in pixels
 *     - left and top in pixels relative to the workspace origin.
 * @private
 */
Blockly.WorkspaceSvg.getContentDimensions_ = function(ws, svgSize) {
  if (ws.scrollbar) {
    return Blockly.WorkspaceSvg.getContentDimensionsBounded_(ws, svgSize);
  } else {
    return Blockly.WorkspaceSvg.getContentDimensionsExact_(ws);
  }
};

/**
 * Get the bounding box for all workspace contents, in pixels.
 * @param {!Blockly.WorkspaceSvg} ws The workspace to inspect.
 * @return {!Object} The dimensions of the contents of the given workspace, as
 *     an object containing
 *     - height and width in pixels
 *     - left, right, top and bottom in pixels relative to the workspace origin.
 * @private
 */
Blockly.WorkspaceSvg.getContentDimensionsExact_ = function(ws) {
  // Block bounding box is in workspace coordinates.
  var blockBox = ws.getBlocksBoundingBox();
  var scale = ws.scale;

  // Convert to pixels.
  var width = blockBox.width * scale;
  var height = blockBox.height * scale;
  var left = blockBox.x * scale;
  var top = blockBox.y * scale;

  return {
    left: left,
    top: top,
    right: left + width,
    bottom: top + height,
    width: width,
    height: height
  };
};

/**
 * Calculate the size of a scrollable workspace, which should include room for a
 * half screen border around the workspace contents.
 * @param {!Blockly.WorkspaceSvg} ws The workspace to measure.
 * @param {!Object} svgSize An object containing height and width attributes in
 *     CSS pixels.  Together they specify the size of the visible workspace, not
 *     including areas covered up by the toolbox.
 * @return {!Object} The dimensions of the contents of the given workspace, as
 *     an object containing
 *     - height and width in pixels
 *     - left and top in pixels relative to the workspace origin.
 * @private
 */
Blockly.WorkspaceSvg.getContentDimensionsBounded_ = function(ws, svgSize) {
  var content = Blockly.WorkspaceSvg.getContentDimensionsExact_(ws);

  // View height and width are both in pixels, and are the same as the SVG size.
  var viewWidth = svgSize.width;
  var viewHeight = svgSize.height;
  var halfWidth = viewWidth / 2;
  var halfHeight = viewHeight / 2;

  // Add a border around the content that is at least half a screenful wide.
  // Ensure border is wide enough that blocks can scroll over entire screen.
  var left = Math.min(content.left - halfWidth, content.right - viewWidth);
  var right = Math.max(content.right + halfWidth, content.left + viewWidth);

  var top = Math.min(content.top - halfHeight, content.bottom - viewHeight);
  var bottom = Math.max(content.bottom + halfHeight, content.top + viewHeight);

  var dimensions = {
    left: left,
    top: top,
    height: bottom - top,
    width: right - left
  };
  return dimensions;
};

/**
 * Return an object with all the metrics required to size scrollbars for a
 * top level workspace.  The following properties are computed:
 * Coordinate system: pixel coordinates.
 * .viewHeight: Height of the visible rectangle,
 * .viewWidth: Width of the visible rectangle,
 * .contentHeight: Height of the contents,
 * .contentWidth: Width of the content,
 * .viewTop: Offset of top edge of visible rectangle from parent,
 * .viewLeft: Offset of left edge of visible rectangle from parent,
 * .contentTop: Offset of the top-most content from the y=0 coordinate,
 * .contentLeft: Offset of the left-most content from the x=0 coordinate.
 * .absoluteTop: Top-edge of view.
 * .absoluteLeft: Left-edge of view.
 * .toolboxWidth: Width of toolbox, if it exists.  Otherwise zero.
 * .toolboxHeight: Height of toolbox, if it exists.  Otherwise zero.
 * .flyoutWidth: Width of the flyout if it is always open.  Otherwise zero.
 * .flyoutHeight: Height of flyout if it is always open.  Otherwise zero.
 * .toolboxPosition: Top, bottom, left or right.
 * @return {!Object} Contains size and position metrics of a top level
 *   workspace.
 * @private
 * @this Blockly.WorkspaceSvg
 */
Blockly.WorkspaceSvg.getTopLevelWorkspaceMetrics_ = function() {

  var toolboxDimensions =
      Blockly.WorkspaceSvg.getDimensionsPx_(this.toolbox_);
  var flyoutDimensions =
      Blockly.WorkspaceSvg.getDimensionsPx_(this.flyout_);

  // Contains height and width in CSS pixels.
  // svgSize is equivalent to the size of the injectionDiv at this point.
  var svgSize = Blockly.svgSize(this.getParentSvg());
  if (this.toolbox_) {
    if (this.toolboxPosition == Blockly.TOOLBOX_AT_TOP ||
        this.toolboxPosition == Blockly.TOOLBOX_AT_BOTTOM) {
      svgSize.height -= toolboxDimensions.height;
    } else if (this.toolboxPosition == Blockly.TOOLBOX_AT_LEFT ||
        this.toolboxPosition == Blockly.TOOLBOX_AT_RIGHT) {
      svgSize.width -= toolboxDimensions.width;
    }
  }

  // svgSize is now the space taken up by the Blockly workspace, not including
  // the toolbox.
  var contentDimensions =
      Blockly.WorkspaceSvg.getContentDimensions_(this, svgSize);

  var absoluteLeft = 0;
  if (this.toolbox_ && this.toolboxPosition == Blockly.TOOLBOX_AT_LEFT) {
    absoluteLeft = toolboxDimensions.width;
  }
  var absoluteTop = 0;
  if (this.toolbox_ && this.toolboxPosition == Blockly.TOOLBOX_AT_TOP) {
    absoluteTop = toolboxDimensions.height;
  }

  var metrics = {
    contentHeight: contentDimensions.height,
    contentWidth: contentDimensions.width,
    contentTop: contentDimensions.top,
    contentLeft: contentDimensions.left,

    viewHeight: svgSize.height,
    viewWidth: svgSize.width,
    viewTop: -this.scrollY,   // Must be in pixels, somehow.
    viewLeft: -this.scrollX,  // Must be in pixels, somehow.

    absoluteTop: absoluteTop,
    absoluteLeft: absoluteLeft,

    toolboxWidth: toolboxDimensions.width,
    toolboxHeight: toolboxDimensions.height,

    flyoutWidth: flyoutDimensions.width,
    flyoutHeight: flyoutDimensions.height,

    toolboxPosition: this.toolboxPosition
  };
  return metrics;
};

/**
 * Sets the X/Y translations of a top level workspace to match the scrollbars.
 * @param {!Object} xyRatio Contains an x and/or y property which is a float
 *     between 0 and 1 specifying the degree of scrolling.
 * @private
 * @this Blockly.WorkspaceSvg
 */
Blockly.WorkspaceSvg.setTopLevelWorkspaceMetrics_ = function(xyRatio, opt_metrics) {
  if (!this.scrollbar) {
    throw 'Attempt to set top level workspace scroll without scrollbars.';
  }
  // PATCH 10 (2026-10-10): reuse caller-provided metrics.
  // ScrollbarPair.resize() already computed hostMetrics and handed it to each
  // Scrollbar.resize(), but the onScroll_ -> setMetrics round-trip called
  // getMetrics() again, once per scrollbar. Taking the object through removes two
  // O(blocks) getMetrics per zoom without changing a single value.
  // Callers that pass nothing (Scrollbar.set, dragging the handle, flyout
  // setMetrics_ overrides) keep the original behaviour.
  var metrics = opt_metrics || this.getMetrics();
  if (goog.isNumber(xyRatio.x)) {
    this.scrollX = -metrics.contentWidth * xyRatio.x - metrics.contentLeft;
  }
  if (goog.isNumber(xyRatio.y)) {
    this.scrollY = -metrics.contentHeight * xyRatio.y - metrics.contentTop;
  }
  var x = this.scrollX + metrics.absoluteLeft;
  var y = this.scrollY + metrics.absoluteTop;
  this.translate(x, y);
  if (this.grid_) {
    this.grid_.moveTo(x, y);
  }
};

/**
 * Update whether this workspace has resizes enabled.
 * If enabled, workspace will resize when appropriate.
 * If disabled, workspace will not resize until re-enabled.
 * Use to avoid resizing during a batch operation, for performance.
 * @param {boolean} enabled Whether resizes should be enabled.
 */
Blockly.WorkspaceSvg.prototype.setResizesEnabled = function(enabled) {
  var reenabled = (!this.resizesEnabled_ && enabled);
  this.resizesEnabled_ = enabled;
  if (reenabled) {
    // Newly enabled.  Trigger a resize.
    this.resizeContents();
  }
};

/**
 * Update whether this workspace has toolbox refreshes enabled.
 * If enabled, the toolbox will refresh when appropriate.
 * If disabled, workspace will not refresh until re-enabled.
 * Use to avoid refreshing during a batch operation, for performance.
 * @param {boolean} enabled Whether refreshes should be enabled.
 */
Blockly.WorkspaceSvg.prototype.setToolboxRefreshEnabled = function(enabled) {
  var reenabled = (!this.toolboxRefreshEnabled_ && enabled);
  this.toolboxRefreshEnabled_ = enabled;
  if (reenabled) {
    // Newly enabled.  Trigger a refresh.
    this.refreshToolboxSelection_();
  }
};


/**
 * Box selection (Ctrl+drag rubber-band, see core/gesture.js).
 * @return {!Set<!Blockly.BlockSvg>} The live set of selected blocks.
 *     Mutate it only through setBoxSelection/clearBoxSelection.
 */
Blockly.WorkspaceSvg.prototype.getBoxSelection = function() {
  if (!this.boxSelection_) {
    this.boxSelection_ = new Set();
  }
  return this.boxSelection_;
};

/**
 * Expand a list of blocks with the blocks nested inside them. A selected block
 * is a visual unit, so its nested contents are selected with it whether or not
 * the selection rectangle touched them. For a C-type block (if / repeat / etc.)
 * this means every block sitting inside its statement input(s) is selected too,
 * recursively — boxing the header grabs the whole structure. A block's own
 * following statements (the chain AFTER the block, outside it) are NOT expanded:
 * that chain is a separate visual unit and only gets selected when the rectangle
 * reaches it. Text input shadows are not selectable units (see
 * BlockSvg.isBoxSelectable) and never join the selection.
 *
 * Colour source: each block records, via sourceOf, the block whose box-select
 * border colour it should use. A directly-hit block keeps its OWN colour. A block
 * reached through a STATEMENT input (a C block's body) also keeps its OWN colour:
 * stacked statements are a separate visual category and never borrow the C block's
 * colour. A block reached through a VALUE input depends on the child, exactly like
 * the contents of a C block: a REAL reporter block keeps its OWN colour (so e.g.
 * operator_random in a `move` block's STEPS socket stays green, and operator_random
 * in a `repeat` block's TIMES socket stays green too — every value-input reporter
 * decides its own border colour), while a SHADOW input field (a number / text box,
 * which renders white with no category colour of its own) inherits the holder's
 * colour so its border matches the container instead of staying grey (2026-10-17,
 * e.g. a `repeat` block's TIMES "10" box is outlined in the repeat's orange, and a
 * number nested inside a reporter borrows that reporter's colour). See the
 * 2026-10-17 report.
 * @param {!Array<!Blockly.BlockSvg>} blocks The hit-tested blocks.
 * @return {{blocks: !Array<!Blockly.BlockSvg>,
 *     sourceOf: !Map<!Blockly.BlockSvg, !Blockly.BlockSvg>}} The blocks plus
 *     their nested contents and the colour-source map consumed by
 *     setBoxSelection.
 * @private
 */
Blockly.WorkspaceSvg.prototype.expandBoxSelectionNested_ = function(blocks) {
  var self = this;
  var expanded = [];
  // sourceOf maps every selected block to the block whose colour it should use.
  var sourceOf = new Map();
  var addBlock = function(block, source) {
    if (sourceOf.has(block)) {
      return;
    }
    sourceOf.set(block, source);
    expanded.push(block);
  };
  // Claim a block's input-connected descendants. `effectiveSource` is the colour
  // a VALUE-connected child inherits — the block that holds it. The rules:
  //  - A directly-hit block, and a block reached through a STATEMENT input (a C
  //    block's body), keep their OWN colour.
  //  - A REAL value child (a reporter block) keeps its OWN colour — exactly like
  //    the contents of a C block. operator_random in a `move` block's STEPS socket
  //    stays green, and operator_random in a `repeat` block's TIMES socket stays
  //    green too: every value-input reporter decides its own border colour
  //    (2026-10-17 clarification).
  //  - A SHADOW value child (a primitive field with no category colour of its own
  //    — it renders white) inherits the holder's colour, so an input field's
  //    border matches its container instead of staying grey (2026-10-17, e.g. the
  //    "10" box of a `repeat` block's TIMES socket is outlined in the repeat's
  //    orange, and a number nested inside a reporter borrows that reporter's
  //    colour).
  //  - `followNext` is false for a directly-hit root: a block's own following
  //    statement chain (its next connection, outside the block) is a separate
  //    visual unit and must NOT be pulled in. It is true for any block reached
  //    THROUGH an input (value or statement), so a C block's whole body — every
  //    block chained on nextConnection after the first — is selected along with
  //    it.
  var walk = function(block, effectiveSource, followNext) {
    var inputList = block.inputList;
    for (var k = 0; k < inputList.length; k++) {
      var input = inputList[k];
      if (!input.connection) {
        continue;
      }
      var child = input.connection.targetBlock();
      if (!child) {
        continue;
      }
      if (sourceOf.has(child)) {
        continue;
      }
      var childSource;
      if (input.type === Blockly.NEXT_STATEMENT) {
        // Statement child (a C block's body) keeps its OWN colour.
        childSource = child;
      } else if (child.isShadow()) {
        // A shadow field has no category colour of its own (it renders white), so
        // inherit the holder's colour — otherwise its border is left grey.
        childSource = effectiveSource;
      } else {
        // A real reporter keeps its OWN colour, exactly like the contents of a C
        // block.
        childSource = child;
      }
      addBlock(child, childSource);
      walk(child, childSource, true);
    }
    // Follow the block's own next connection to chain the rest of this
    // statement. Only when reached through an input (so a C block's full body is
    // captured); a directly-hit root's trailing chain stays a separate unit.
    if (followNext && block.nextConnection) {
      var next = block.nextConnection.targetBlock();
      if (next && !sourceOf.has(next)) {
        addBlock(next, next);
        walk(next, next, true);
      }
    }
  };
  // Pass 1: claim every directly-hit REAL block (one with a category colour of
  // its own) as a root that keeps its own colour + darkened fill. The rubber-band
  // rect lists EVERY intersecting block — including nested children (see
  // updateBoxSelect_, which pushes each descendant whose box overlaps). A shadow
  // value/field child has no colour of its own (it renders white) and must NOT be
  // claimed here: as a direct hit it would be styled darken(white) -> grey (the
  // "input edges turn grey" bug, 2026-10-17). Shadows are reached through walk()
  // from their real parent and borrow that parent's colour, so a whole-stack
  // rubber band still outlines every input in its container's colour. Every real
  // block the rect actually covers (the hat, a `move` block, a `repeat` header,
  // and the blocks inside it) is in `blocks` and is claimed here individually, so
  // none of them is dropped from the selection (2026-10-17 follow-up).
  var hitSet = new Set(blocks);
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (!block || block.workspace !== self || !block.getSvgRoot() ||
        !block.isBoxSelectable()) {
      continue;
    }
    // A shadow has no colour of its own — let walk() colour it from its holding
    // block instead of treating it as a direct hit (which would grey it out).
    if (block.isShadow()) {
      continue;
    }
    if (!sourceOf.has(block)) {
      addBlock(block, block);
    }
  }
  // Pass 2: expand each hit block's inputs. A directly-hit C block does not
  // propagate its colour to its inputs (its condition reporter and body reset to
  // their own colours); a directly-hit non-C block does propagate. A directly-hit
  // root's own following statement chain is NOT followed (followNext=false); it
  // is a separate visual unit, selected only when the rectangle reaches it.
  for (var j = 0; j < blocks.length; j++) {
    var root = blocks[j];
    if (!root || root.workspace !== self || !root.getSvgRoot() ||
        !root.isBoxSelectable()) {
      continue;
    }
    walk(root, root, false);
  }
  return { blocks: expanded, sourceOf: sourceOf };
};

/**
 * Compute the box-select colours for a block, mirroring the logic in
 * BlockSvg.setBoxSelectStyle. Used to paint a value-input child (a reporter /
 * condition) with the colour of the block that holds it, so an input's border
 * matches its container; a C block's body keeps its own colour. The fill is a
 * darkened version of the block's own fill (null for very light blocks, which
 * would otherwise read as grey), and the stroke is a brighter tint of the same
 * hue (see expandBoxSelectionNested_ and the 2026-10-18 report). C / loop headers
 * now also return a fill — their path frames the body as a hole so only the frame
 * tints.
 * @param {!Blockly.BlockSvg} block The containing block.
 * @return {?{stroke: !Array<number>, fill: (?Array<number>|null)}} null when the
 *     block has no colour.
 * @private
 */
Blockly.WorkspaceSvg.prototype.getBoxSelectColors_ = function(block) {
  if (!block.colour_) {
    return null;
  }
  var rgb = goog.color.hexToRgb(block.colour_);
  var luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  var stroke = luma > 200 ? goog.color.darken(rgb, 0.3) :
      goog.color.lighten(rgb, 0.4);
  // Fill is only consulted for context; nested children always pass null (keep
  // their own fill — see setBoxSelection), and directly-hit blocks compute their
  // own fill inside setBoxSelectStyle. Mirror that logic here: very light blocks
  // skip the fill (would read as grey), everything else uses a darkened version
  // of its own colour, including C / loop headers (2026-10-18).
  var fill = luma > 200 ? null : goog.color.darken(rgb, 0.2);
  return { stroke: stroke, fill: fill };
};

/**
 * Replace the box selection with the given blocks. Blocks dropping out of the
 * selection lose their highlight; blocks entering it gain one. Selection is
 * per block, so any rendered block of this workspace may be selected (not
 * just top-level stacks); foreign-workspace and unrendered blocks are ignored.
 * Nested blocks come along with their host (see expandBoxSelectionNested_).
 * @param {!Array<!Blockly.BlockSvg>} blocks The blocks to select.
 */
Blockly.WorkspaceSvg.prototype.setBoxSelection = function(blocks) {
  var selection = this.getBoxSelection();
  var exp = this.expandBoxSelectionNested_(blocks);
  var next = new Set(exp.blocks);
  selection.forEach(function(block) {
    if (!next.has(block) && block.getSvgRoot()) {
      block.setBoxSelectStyle(false);
    }
  });
  // A nested child (a value-input reporter, or a C-block's body block) inherits
  // the box-select colours of the block that contains it, so its border matches
  // the holding block instead of its own category colour. See 2026-10-17 report:
  // a boxed "move N steps" should outline its numeric input in the same colour
  // as the move block. Compute each containing block's colours once.
  var sourceColors = new Map();
  exp.sourceOf.forEach(function(source, block) {
    if (sourceColors.has(source)) {
      return;
    }
    sourceColors.set(source, this.getBoxSelectColors_(source));
  }, this);
  // Style every block in the new selection, not only the newly-entering ones. A
  // block can flip between "directly hit" and "nested child" as the rubber band
  // grows or shrinks, so its fill state must be recomputed each time (a white
  // block briefly hit on its own would otherwise keep the grey fill it picked up
  // when it later becomes a nested child). Re-styling an already-selected block
  // is idempotent; blocks that left the selection were cleared above.
  next.forEach(function(block) {
    var source = exp.sourceOf.get(block);
    if (source && source !== block) {
      // A nested value/statement child inherits only its CONTAINER'S BORDER
      // colour (so an input's outline matches the block that holds it); it keeps
      // its OWN fill untouched (2026-10-18). Pass null for the fill so
      // BlockSvg.setBoxSelectStyle paints the outline alone and leaves the
      // child's original fill as-is.
      var colors = sourceColors.get(source);
      block.setBoxSelectStyle(true, colors ? colors.stroke : undefined, null);
    } else {
      // Directly-hit block: darkened own fill + brighter own-colour border.
      block.setBoxSelectStyle(true);
    }
  });
  this.boxSelection_ = next;
};

/**
 * Whether the given block is part of the box selection.
 * @param {!Blockly.BlockSvg} block The block to test.
 * @return {boolean} True if the block is box-selected.
 */
Blockly.WorkspaceSvg.prototype.isBlockBoxSelected = function(block) {
  return this.getBoxSelection().has(block);
};

/**
 * Drop the box selection and remove all of its highlights.
 */
Blockly.WorkspaceSvg.prototype.clearBoxSelection = function() {
  var selection = this.getBoxSelection();
  selection.forEach(function(block) {
    if (block.getSvgRoot()) {
      block.setBoxSelectStyle(false);
    }
  });
  selection.clear();
};

/**
 * Dispose of all blocks in workspace, with an optimization to prevent resizes.
 */
Blockly.WorkspaceSvg.prototype.clear = function() {
  this.setResizesEnabled(false);
  Blockly.WorkspaceSvg.superClass_.clear.call(this);
  this.setResizesEnabled(true);
  // PATCH 9 (2026-10-10): resizes are suppressed above, so resizeContents() bails
  // out early and never invalidates. Do it explicitly.
  this.invalidateContentBounds_();
  // The selected blocks are gone; drop the box selection with them.
  this.clearBoxSelection();
};

/**
 * Register a callback function associated with a given key, for clicks on
 * buttons and labels in the flyout.
 * For instance, a button specified by the XML
 * <button text="create variable" callbackKey="CREATE_VARIABLE"></button>
 * should be matched by a call to
 * registerButtonCallback("CREATE_VARIABLE", yourCallbackFunction).
 * @param {string} key The name to use to look up this function.
 * @param {function(!Blockly.FlyoutButton)} func The function to call when the
 *     given button is clicked.
 */
Blockly.WorkspaceSvg.prototype.registerButtonCallback = function(key, func) {
  goog.asserts.assert(goog.isFunction(func),
      'Button callbacks must be functions.');
  this.flyoutButtonCallbacks_[key] = func;
};

/**
 * Get the callback function associated with a given key, for clicks on buttons
 * and labels in the flyout.
 * @param {string} key The name to use to look up the function.
 * @return {?function(!Blockly.FlyoutButton)} The function corresponding to the
 *     given key for this workspace; null if no callback is registered.
 */
Blockly.WorkspaceSvg.prototype.getButtonCallback = function(key) {
  var result = this.flyoutButtonCallbacks_[key];
  return result ? result : null;
};

/**
 * Remove a callback for a click on a button in the flyout.
 * @param {string} key The name associated with the callback function.
 */
Blockly.WorkspaceSvg.prototype.removeButtonCallback = function(key) {
  this.flyoutButtonCallbacks_[key] = null;
};

/**
 * Register a callback function associated with a given key, for populating
 * custom toolbox categories in this workspace.  See the variable and procedure
 * categories as an example.
 * @param {string} key The name to use to look up this function.
 * @param {function(!Blockly.Workspace):!Array.<!Element>} func The function to
 *     call when the given toolbox category is opened.
 */
Blockly.WorkspaceSvg.prototype.registerToolboxCategoryCallback = function(key,
    func) {
  goog.asserts.assert(goog.isFunction(func),
      'Toolbox category callbacks must be functions.');
  this.toolboxCategoryCallbacks_[key] = func;
};

/**
 * Get the callback function associated with a given key, for populating
 * custom toolbox categories in this workspace.
 * @param {string} key The name to use to look up the function.
 * @return {?function(!Blockly.Workspace):!Array.<!Element>} The function
 *     corresponding to the given key for this workspace, or null if no function
 *     is registered.
 */
Blockly.WorkspaceSvg.prototype.getToolboxCategoryCallback = function(key) {
  var result = this.toolboxCategoryCallbacks_[key];
  return result ? result : null;
};

/**
 * Remove a callback for a click on a custom category's name in the toolbox.
 * @param {string} key The name associated with the callback function.
 */
Blockly.WorkspaceSvg.prototype.removeToolboxCategoryCallback = function(key) {
  this.toolboxCategoryCallbacks_[key] = null;
};

/**
 * Look up the gesture that is tracking this touch stream on this workspace.
 * May create a new gesture.
 * @param {!Event} e Mouse event or touch event
 * @return {Blockly.Gesture} The gesture that is tracking this touch stream,
 *     or null if no valid gesture exists.
 * @package
 */
Blockly.WorkspaceSvg.prototype.getGesture = function(e) {
  var isStart = (e.type == 'mousedown' || e.type == 'touchstart');

  var gesture = this.currentGesture_;
  if (gesture) {
    if (isStart && gesture.hasStarted()) {
      // That's funny.  We must have missed a mouse up.
      // Cancel it, rather than try to retrieve all of the state we need.
      gesture.cancel();
      return null;
    }
    return gesture;
  }

  // No gesture existed on this workspace, but this looks like the start of a
  // new gesture.
  if (isStart) {
    this.currentGesture_ = new Blockly.Gesture(e, this);
    return this.currentGesture_;
  }
  // No gesture existed and this event couldn't be the start of a new gesture.
  return null;
};

/**
 * Clear the reference to the current gesture.
 * @package
 */
Blockly.WorkspaceSvg.prototype.clearGesture = function() {
  this.currentGesture_ = null;

  // Unloading is suspended while a block is being moved (see
  // WorkspaceSvg.isMovingBlocks_), so re-evaluate the viewport now that the
  // gesture is over; otherwise stacks that left during the drag stay loaded.
  this.queueIntersectionCheck();

  if (this.checkProcedureReturnAfterGesture_) {
    this.processProcedureReturnsChanged_();
  }
};

/**
 * Cancel the current gesture, if one exists.
 * @package
 */
Blockly.WorkspaceSvg.prototype.cancelCurrentGesture = function() {
  if (this.currentGesture_) {
    this.currentGesture_.cancel();
  }
};

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
Blockly.WorkspaceSvg.prototype.startDragWithFakeEvent = function(fakeEvent,
    block) {
  Blockly.Touch.clearTouchIdentifier();
  Blockly.Touch.checkTouchIdentifier(fakeEvent);
  var gesture = block.workspace.getGesture(fakeEvent);
  gesture.forceStartBlockDrag(fakeEvent, block);
};

/**
 * Like startDragWithFakeEvent, but starts a rigid drag of several top-level
 * blocks together (used to drag a duplicated box selection).
 * @param {!Object} fakeEvent An object with the properties needed to start a
 *     drag, including clientX and clientY.
 * @param {!Array<!Blockly.BlockSvg>} blocks The top-level blocks to drag.
 * @package
 */
Blockly.WorkspaceSvg.prototype.startDragWithFakeEventForBlocks = function(
    fakeEvent, blocks) {
  Blockly.Touch.clearTouchIdentifier();
  Blockly.Touch.checkTouchIdentifier(fakeEvent);
  var gesture = blocks[0].workspace.getGesture(fakeEvent);
  gesture.forceStartBoxDrag(fakeEvent, blocks);
};

/**
 * Get the audio manager for this workspace.
 * @return {Blockly.WorkspaceAudio} The audio manager for this workspace.
 */
Blockly.WorkspaceSvg.prototype.getAudioManager = function() {
  return this.audioManager_;
};

/**
 * Get the grid object for this workspace, or null if there is none.
 * @return {Blockly.Grid} The grid object for this workspace.
 * @package
 */
Blockly.WorkspaceSvg.prototype.getGrid = function() {
  return this.grid_;
};

// Export symbols that would otherwise be renamed by Closure compiler.
Blockly.WorkspaceSvg.prototype['setVisible'] =
    Blockly.WorkspaceSvg.prototype.setVisible;
