/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2026 Google Inc.
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
 * @fileoverview .sprite3 loader for the vertical playground test pages.
 *
 * Ports the minimal subset of scratch-vm needed to render a `sprite.json`
 * inside a scratch-blocks workspace (no VM, no runtime, blocks layer only):
 *   - scratch-vm/src/serialization/sb3.js
 *       deserializeBlocks / deserializeInputs / deserializeFields /
 *       deserializeInputDesc  (compact primitive encoding of shadows)
 *   - scratch-vm/src/engine/blocks.js
 *       Blocks.prototype.blockToXML / mutationToXML
 *   - scratch-vm/src/engine/comment.js
 *       Comment.prototype.toXML
 *
 * A .sprite3 is a zip containing `sprite.json` plus costume/sound assets.
 * Requires JSZip (window.JSZip) to be loaded first.
 *
 * Usage from a playground page:
 *   <input type="button" value="Open .sprite3" onclick="Sprite3Loader.open(workspace)">
 *   <span id="sprite3Status"></span>
 *   <div id="sprite3Costume"></div>
 */
window.Sprite3Loader = (function() {
  'use strict';

  // Input relationship constants (sb3.js:40-42).
  var INPUT_SAME_BLOCK_SHADOW = 1; // block and shadow are the same id
  var INPUT_BLOCK_NO_SHADOW = 2; // real block, no shadow
  var INPUT_DIFF_BLOCK_SHADOW = 3; // block + different shadow (obscured)

  // Primitive shadow constants (sb3.js:64-82). These blocks are usually
  // shadows and are stored in the `blocks` map as compact arrays instead of
  // full objects.
  var MATH_NUM_PRIMITIVE = 4;
  var POSITIVE_NUM_PRIMITIVE = 5;
  var WHOLE_NUM_PRIMITIVE = 6;
  var INTEGER_NUM_PRIMITIVE = 7;
  var ANGLE_NUM_PRIMITIVE = 8;
  var COLOR_PICKER_PRIMITIVE = 9;
  var TEXT_PRIMITIVE = 10;
  var BROADCAST_PRIMITIVE = 11;
  var VAR_PRIMITIVE = 12;
  var LIST_PRIMITIVE = 13;

  // primitive constant -> [opcode, field name] (sb3.js:86-97).
  var PRIMITIVE_OPCODE_INFO = {};
  PRIMITIVE_OPCODE_INFO[MATH_NUM_PRIMITIVE] = ['math_number', 'NUM'];
  PRIMITIVE_OPCODE_INFO[POSITIVE_NUM_PRIMITIVE] = ['math_positive_number', 'NUM'];
  PRIMITIVE_OPCODE_INFO[WHOLE_NUM_PRIMITIVE] = ['math_whole_number', 'NUM'];
  PRIMITIVE_OPCODE_INFO[INTEGER_NUM_PRIMITIVE] = ['math_integer', 'NUM'];
  PRIMITIVE_OPCODE_INFO[ANGLE_NUM_PRIMITIVE] = ['math_angle', 'NUM'];
  PRIMITIVE_OPCODE_INFO[COLOR_PICKER_PRIMITIVE] = ['colour_picker', 'COLOUR'];
  PRIMITIVE_OPCODE_INFO[TEXT_PRIMITIVE] = ['text', 'TEXT'];
  PRIMITIVE_OPCODE_INFO[BROADCAST_PRIMITIVE] = ['event_broadcast_menu', 'BROADCAST_OPTION'];
  PRIMITIVE_OPCODE_INFO[VAR_PRIMITIVE] = ['data_variable', 'VARIABLE'];
  PRIMITIVE_OPCODE_INFO[LIST_PRIMITIVE] = ['data_listcontents', 'LIST'];

  // Field name -> variabletype attribute emitted in the XML
  // (matches Blockly.BROADCAST_MESSAGE_VARIABLE_TYPE in this fork).
  var VARIABLE_TYPE_BY_FIELD = {
    BROADCAST_OPTION: 'broadcast_msg',
    VARIABLE: '',
    LIST: 'list'
  };

  var uidCounter = 0;

  function nextUid() {
    // Mirrors the role of scratch-vm's uid(): fresh ids for primitives that
    // only exist as compact arrays in sprite.json.
    return 'sprite3-' + Date.now().toString(36) + '-' + (uidCounter++);
  }

  function xmlEscape(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
  }

  // ---------------------------------------------------------------------
  // Deserialization: sprite.json compact form -> scratch-vm internal form.
  // Port of scratch-vm/src/serialization/sb3.js (deserializeInputDesc,
  // deserializeInputs, deserializeFields, deserializeBlocks).
  // ---------------------------------------------------------------------

  function deserializeInputDesc(inputDescOrId, parentId, isShadow, blocks) {
    if (!Array.isArray(inputDescOrId)) {
      // Already a block id reference.
      return inputDescOrId;
    }
    var primitiveType = inputDescOrId[0];
    var info = PRIMITIVE_OPCODE_INFO[primitiveType];
    if (!info) {
      console.error('[Sprite3Loader] Unknown primitive type: ' +
          JSON.stringify(inputDescOrId));
      return null;
    }
    var fieldName = info[1];
    var field = {
      name: fieldName,
      value: inputDescOrId[1]
    };
    if (primitiveType === BROADCAST_PRIMITIVE ||
        primitiveType === VAR_PRIMITIVE ||
        primitiveType === LIST_PRIMITIVE) {
      field.id = inputDescOrId[2];
      field.variableType = VARIABLE_TYPE_BY_FIELD[fieldName];
    }
    var primitiveObj = {
      id: nextUid(),
      opcode: info[0],
      next: null,
      parent: parentId,
      inputs: {},
      fields: {},
      shadow: isShadow,
      topLevel: false
    };
    primitiveObj.fields[fieldName] = field;
    // Standalone variable/list reporters carry their canvas position.
    if ((primitiveType === VAR_PRIMITIVE || primitiveType === LIST_PRIMITIVE) &&
        inputDescOrId.length > 3) {
      primitiveObj.topLevel = true;
      primitiveObj.x = inputDescOrId[3];
      primitiveObj.y = inputDescOrId[4];
    }
    blocks[primitiveObj.id] = primitiveObj;
    return primitiveObj.id;
  }

  function deserializeInputs(inputs, parentId, blocks) {
    var obj = {};
    for (var inputName in inputs) {
      if (!Object.prototype.hasOwnProperty.call(inputs, inputName)) {
        continue;
      }
      var inputDescArr = inputs[inputName];
      if (!Array.isArray(inputDescArr)) {
        continue;
      }
      var block = null;
      var shadow = null;
      var blockShadowInfo = inputDescArr[0];
      if (blockShadowInfo === INPUT_SAME_BLOCK_SHADOW) {
        block = shadow =
            deserializeInputDesc(inputDescArr[1], parentId, true, blocks);
      } else if (blockShadowInfo === INPUT_BLOCK_NO_SHADOW) {
        block = deserializeInputDesc(inputDescArr[1], parentId, false, blocks);
      } else { // INPUT_DIFF_BLOCK_SHADOW
        block = deserializeInputDesc(inputDescArr[1], parentId, false, blocks);
        shadow = deserializeInputDesc(inputDescArr[2], parentId, true, blocks);
      }
      obj[inputName] = {
        name: inputName,
        block: block,
        shadow: shadow
      };
    }
    return obj;
  }

  function deserializeFields(fields) {
    var obj = {};
    for (var fieldName in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, fieldName)) {
        continue;
      }
      var fieldDescArr = fields[fieldName];
      if (!Array.isArray(fieldDescArr)) {
        continue;
      }
      obj[fieldName] = {
        name: fieldName,
        value: fieldDescArr[0]
      };
      if (fieldDescArr.length > 1) {
        obj[fieldName].id = fieldDescArr[1];
      }
      if (Object.prototype.hasOwnProperty.call(VARIABLE_TYPE_BY_FIELD, fieldName)) {
        obj[fieldName].variableType = VARIABLE_TYPE_BY_FIELD[fieldName];
      }
    }
    return obj;
  }

  function deserializeBlocks(blocks) {
    for (var blockId in blocks) {
      if (!Object.prototype.hasOwnProperty.call(blocks, blockId)) {
        continue;
      }
      var block = blocks[blockId];
      if (Array.isArray(block)) {
        // A primitive sitting directly in the blocks map (standalone
        // variable/list reporter or an uncompressed shadow).
        delete blocks[blockId];
        deserializeInputDesc(block, null, false, blocks);
        continue;
      }
      block.id = blockId;
      block.inputs = deserializeInputs(block.inputs || {}, blockId, blocks);
      block.fields = deserializeFields(block.fields || {});
    }
    return blocks;
  }

  // ---------------------------------------------------------------------
  // Serialization: internal form -> Blockly XML string.
  // Port of scratch-vm/src/engine/blocks.js (blockToXML, mutationToXML) and
  // scratch-vm/src/engine/comment.js (Comment.toXML).
  // ---------------------------------------------------------------------

  function mutationToXML(mutation) {
    var tagName = mutation.tagName || 'mutation';
    var s = '<' + tagName;
    for (var prop in mutation) {
      if (prop === 'children' || prop === 'tagName') {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(mutation, prop)) {
        continue;
      }
      var value = (typeof mutation[prop] === 'string') ?
          xmlEscape(mutation[prop]) : mutation[prop];
      // Dynamic extension blocks store their blockInfo as JSON.
      if (prop === 'blockInfo') {
        value = xmlEscape(JSON.stringify(mutation[prop]));
      }
      s += ' ' + prop + '="' + value + '"';
    }
    s += '>';
    // Nested mutations (e.g. procedure argument reporters).
    var children = mutation.children;
    if (children) {
      for (var i = 0; i < children.length; i++) {
        s += mutationToXML(children[i]);
      }
    }
    return s + '</' + tagName + '>';
  }

  function commentToXML(commentId, comment) {
    var s = '<comment id="' + xmlEscape(commentId) + '"' +
        ' x="' + (comment.x || 0) + '" y="' + (comment.y || 0) + '"';
    if (typeof comment.width === 'number') {
      s += ' w="' + comment.width + '"';
    }
    if (typeof comment.height === 'number') {
      s += ' h="' + comment.height + '"';
    }
    s += ' pinned="' + (comment.blockId ? 'true' : 'false') + '"' +
        ' minimized="' + (comment.minimized ? 'true' : 'false') + '">' +
        xmlEscape(comment.text || '') +
        '</comment>';
    return s;
  }

  function blockToXML(blockId, blocks, comments, skippedTypes) {
    var block = blocks[blockId];
    // Some projects reference non-existent blocks (stale next/input ids);
    // skip them like scratch-vm does so the project still loads.
    if (!block) {
      return '';
    }
    // A top-level shadow (e.g. an argument reporter dragged out of a custom
    // block definition onto the canvas) cannot live at the workspace root:
    // scratch-blocks asserts "Shadow block cannot be a top-level block."
    // (core/xml.js:487-488). scratch-gui generates the same XML and swallows
    // the resulting load error (scratch-gui/src/containers/blocks.jsx:527-543),
    // which leaves the block out of the workspace. Skip it here so the rest
    // of the sprite still loads cleanly.
    if (block.shadow && block.topLevel) {
      console.warn('[Sprite3Loader] Skipping top-level shadow block: ' +
          block.opcode + ' (' + block.id + ')');
      return '';
    }
    // Skip block types the host page has not defined. scratch-gui loads every
    // extension so it never sees this; the vertical playground ships without
    // blocks_vertical/pen.js (deleted in 2c0bf6b8), and an undefined type
    // makes workspace.newBlock() throw "Unknown block type" at
    // core/block.js:177, which aborts the rest of domToWorkspace. Skipping
    // the block drops its subtree with it; everything else keeps loading.
    if (skippedTypes && typeof Blockly !== 'undefined' && Blockly.Blocks &&
        !Object.prototype.hasOwnProperty.call(Blockly.Blocks, block.opcode)) {
      skippedTypes[block.opcode] = (skippedTypes[block.opcode] || 0) + 1;
      return '';
    }
    var tagName = block.shadow ? 'shadow' : 'block';
    var s = '<' + tagName +
        ' id="' + xmlEscape(block.id) + '"' +
        ' type="' + xmlEscape(block.opcode) + '"';
    if (block.topLevel) {
      s += ' x="' + (block.x || 0) + '" y="' + (block.y || 0) + '"';
    }
    s += '>';
    // Comment must come before mutation/inputs/fields.
    var commentId = block.comment;
    if (commentId && comments &&
        Object.prototype.hasOwnProperty.call(comments, commentId)) {
      s += commentToXML(commentId, comments[commentId]);
    }
    if (block.mutation) {
      s += mutationToXML(block.mutation);
    }
    for (var input in block.inputs) {
      if (!Object.prototype.hasOwnProperty.call(block.inputs, input)) {
        continue;
      }
      var blockInput = block.inputs[input];
      if (blockInput.block || blockInput.shadow) {
        s += '<value name="' + xmlEscape(blockInput.name || input) + '">';
        if (blockInput.block) {
          s += blockToXML(blockInput.block, blocks, comments, skippedTypes);
        }
        if (blockInput.shadow && blockInput.shadow !== blockInput.block) {
          // Obscured shadow behind a real block.
          s += blockToXML(blockInput.shadow, blocks, comments, skippedTypes);
        }
        s += '</value>';
      }
    }
    for (var field in block.fields) {
      if (!Object.prototype.hasOwnProperty.call(block.fields, field)) {
        continue;
      }
      var blockField = block.fields[field];
      s += '<field name="' + xmlEscape(blockField.name || field) + '"';
      if (blockField.id) {
        s += ' id="' + xmlEscape(blockField.id) + '"';
      }
      if (typeof blockField.variableType === 'string') {
        s += ' variabletype="' + xmlEscape(blockField.variableType) + '"';
      }
      var value = blockField.value;
      if (value === null || value === undefined) {
        value = '';
      }
      s += '>' + (typeof value === 'string' ? xmlEscape(value) : value) +
          '</field>';
    }
    if (block.next) {
      var nextXml = blockToXML(block.next, blocks, comments, skippedTypes);
      // Guard against dangling next ids: an empty <next></next> would be
      // serialized back as a real (null) next connection.
      if (nextXml) {
        s += '<next>' + nextXml + '</next>';
      }
    }
    return s + '</' + tagName + '>';
  }

  // ---------------------------------------------------------------------
  // sprite.json -> workspace XML.
  // ---------------------------------------------------------------------

  function variablesToXML(sprite) {
    // <variables> must be the first child of <xml> (xml.js:496-504).
    var s = '<variables>';
    var id;
    for (id in sprite.variables) {
      if (Object.prototype.hasOwnProperty.call(sprite.variables, id)) {
        // sprite.variables[id] = [name, value]
        s += '<variable id="' + xmlEscape(id) + '" type=""' +
            ' islocal="false" iscloud="false">' +
            xmlEscape(sprite.variables[id][0]) + '</variable>';
      }
    }
    for (id in sprite.lists) {
      if (Object.prototype.hasOwnProperty.call(sprite.lists, id)) {
        // sprite.lists[id] = [name, contents]
        s += '<variable id="' + xmlEscape(id) + '" type="list"' +
            ' islocal="false" iscloud="false">' +
            xmlEscape(sprite.lists[id][0]) + '</variable>';
      }
    }
    for (id in sprite.broadcasts) {
      if (Object.prototype.hasOwnProperty.call(sprite.broadcasts, id)) {
        // sprite.broadcasts[id] = name (plain string)
        s += '<variable id="' + xmlEscape(id) + '" type="broadcast_msg"' +
            ' islocal="false" iscloud="false">' +
            xmlEscape(sprite.broadcasts[id]) + '</variable>';
      }
    }
    return s + '</variables>';
  }

  /**
   * Convert a parsed sprite.json object into a Blockly workspace XML string.
   * @param {!Object} sprite The parsed contents of sprite.json.
   * @param {Object=} opt_skippedTypes Optional collector object; filled with
   *     {opcode: count} for every block type skipped because the host page
   *     does not define it.
   * @return {string} XML string for Blockly.Xml.textToDom.
   */
  function spriteJsonToXml(sprite, opt_skippedTypes) {
    // Deep copy: deserialization mutates the blocks map.
    var blocks = deserializeBlocks(
        JSON.parse(JSON.stringify(sprite.blocks || {})));
    var comments = sprite.comments || {};
    var skippedTypes = opt_skippedTypes || null;

    // Workspace-level comments (blockId === null) live at the top of <xml>.
    var commentsXml = '';
    for (var cid in comments) {
      if (Object.prototype.hasOwnProperty.call(comments, cid) &&
          !comments[cid].blockId) {
        commentsXml += commentToXML(cid, comments[cid]);
      }
    }

    // Top-level scripts, in blocks-map order.
    var blocksXml = '';
    for (var bid in blocks) {
      if (Object.prototype.hasOwnProperty.call(blocks, bid) &&
          blocks[bid].topLevel) {
        blocksXml += blockToXML(bid, blocks, comments, skippedTypes);
      }
    }

    if (skippedTypes) {
      var names = Object.keys(skippedTypes);
      if (names.length) {
        console.warn('[Sprite3Loader] Skipped block types not defined on ' +
            'this page: ' + names.map(function(name) {
              return name + ' ×' + skippedTypes[name];
            }).join(', '));
      }
    }

    return '<xml xmlns="http://www.w3.org/1999/xhtml">' +
        variablesToXML(sprite) + commentsXml + blocksXml + '</xml>';
  }

  // ---------------------------------------------------------------------
  // File loading (browser side).
  // ---------------------------------------------------------------------

  function setStatus(text, isError) {
    var el = document.getElementById('sprite3Status');
    if (el) {
      el.textContent = text;
      el.style.color = isError ? '#d9534f' : '';
    }
  }

  function ensureFileInput() {
    var input = document.getElementById('sprite3Input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'sprite3Input';
      input.accept = '.sprite3,.sb3,.zip';
      input.style.display = 'none';
      input.addEventListener('change', function() {
        var file = input.files && input.files[0];
        // Reset first so picking the same file twice still fires change.
        input.value = '';
        if (file) {
          loadFile(file, window.workspace);
        }
      });
      document.body.appendChild(input);
    }
    return input;
  }

  /**
   * Open the file picker and load the chosen .sprite3 into the workspace.
   * @param {!Object} workspace Target workspace (defaults to window.workspace).
   */
  function open(workspace) {
    if (!window.JSZip) {
      setStatus('JSZip not loaded (check ../node_modules/jszip/dist/jszip.min.js)',
          true);
      return;
    }
    workspace = workspace || window.workspace;
    if (!workspace) {
      setStatus('Workspace not initialized', true);
      return;
    }
    ensureFileInput().click();
  }

  function loadedMessage(sprite) {
    return 'Loaded: ' + (sprite.name || 'Unnamed sprite');
  }

  function showCostumes(sprite, zip) {
    var container = document.getElementById('sprite3Costume');
    if (!container) {
      return;
    }
    container.innerHTML = '';
    var costumes = sprite.costumes || [];
    if (!costumes.length) {
      return;
    }
    var current = Math.min(sprite.currentCostume || 0, costumes.length - 1);
    // Only preview the current costume plus the next few; a sprite can carry
    // dozens of SVGs and the playground sidebar is small.
    var end = Math.min(costumes.length, current + 4);
    var chain = Promise.resolve();
    for (var i = current; i < end; i++) {
      (function(costume, index) {
        chain = chain.then(function() {
          var entry = zip.file(costume.md5ext);
          if (!entry) {
            return;
          }
          return entry.async('string').then(function(svgText) {
            var wrapper = document.createElement('div');
            var img = document.createElement('img');
            img.src = 'data:image/svg+xml;charset=utf-8,' +
                encodeURIComponent(svgText);
            img.alt = costume.name;
            img.title = costume.name +
                (index === current ? ' (current costume)' : '');
            img.style.maxWidth = '96px';
            img.style.maxHeight = '96px';
            img.style.margin = '2px';
            img.style.verticalAlign = 'middle';
            img.style.background = '#fff';
            img.style.border = '1px solid #ccc';
            wrapper.appendChild(img);
            container.appendChild(wrapper);
          });
        });
      })(costumes[i], i);
    }
  }

  /**
   * Load a .sprite3 (or .sb3) ArrayBuffer into the workspace.
   * @param {!ArrayBuffer} buffer The raw file contents.
   * @param {!Object} workspace Target workspace.
   * @return {!Promise} Resolves with the loaded sprite object.
   */
  function loadArrayBuffer(buffer, workspace) {
    return JSZip.loadAsync(buffer).then(function(zip) {
      var fromProject = false;
      var entry = zip.file('sprite.json');
      if (!entry) {
        entry = zip.file('project.json');
        fromProject = true;
      }
      if (!entry) {
        throw new Error('sprite.json or project.json not found in the archive');
      }
      return entry.async('string').then(function(text) {
        var json = JSON.parse(text);
        var sprite = json;
        if (fromProject) {
          var targets = json.targets || [];
          sprite = null;
          for (var i = 0; i < targets.length; i++) {
            if (!targets[i].isStage) {
              sprite = targets[i];
              break;
            }
          }
          if (!sprite) {
            sprite = targets[0];
          }
          if (!sprite) {
            throw new Error('No targets found in project.json');
          }
        }
        return {sprite: sprite, zip: zip, fromProject: fromProject};
      });
    }).then(function(result) {
      var sprite = result.sprite;
      var skipped = {};
      var xmlText = spriteJsonToXml(sprite, skipped);
      var dom = Blockly.Xml.textToDom(xmlText);
      try {
        Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, workspace);
      } catch (error) {
        // Mirrors scratch-gui/src/containers/blocks.jsx:527-543: a single bad
        // element must not abort the whole load. Keep whatever rendered and
        // report it in the status line.
        console.error('[Sprite3Loader] Workspace update error:', error);
        setStatus(loadedMessage(sprite) +
            ' (partial: ' + (error && error.message ? error.message : error) + ')');
        showCostumes(sprite, result.zip);
        return sprite;
      }
      setStatus(loadedMessage(sprite));
      showCostumes(sprite, result.zip);
      return sprite;
    });
  }

  /**
   * Load a File picked from the file input.
   * @param {!File} file The chosen .sprite3 file.
   * @param {!Object} workspace Target workspace.
   * @return {!Promise} Resolves with the loaded sprite object.
   */
  function loadFile(file, workspace) {
    workspace = workspace || window.workspace;
    if (!workspace) {
      setStatus('Workspace not initialized', true);
      return Promise.reject(new Error('no workspace'));
    }
    setStatus('Loading ' + file.name + ' ...');
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        loadArrayBuffer(reader.result, workspace).then(resolve, reject);
      };
      reader.onerror = function() {
        reject(reader.error);
      };
      reader.readAsArrayBuffer(file);
    }).catch(function(error) {
      console.error('[Sprite3Loader]', error);
      setStatus('Load failed: ' +
          (error && error.message ? error.message : error), true);
      throw error;
    });
  }

  return {
    open: open,
    loadFile: loadFile,
    loadArrayBuffer: loadArrayBuffer,
    spriteJsonToXml: spriteJsonToXml,
    deserializeBlocks: deserializeBlocks,
    blockToXML: blockToXML
  };
})();
