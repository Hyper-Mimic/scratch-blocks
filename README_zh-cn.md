# Hyper-Mimic/scratch-blocks

[English](README.md) | 简体中文

## 演练场

 - **垂直积木**：https://turbowarp.github.io/scratch-blocks/tests/vertical_playground_compressed.html

## 本地开发

需要 Node.js（16 或更高版本）、Python（2 或 3）和 Java。以下环境已知可用，但其他多数环境应该也能工作：

 - Windows 10、Python 3.12.1（Microsoft Store）、Node.js 20.10.0（nodejs.org 安装包）、Java 11（Temurin-11.0.21+9）
 - macOS 14.2.1、Python 3.11.6（Apple 自带）、Node.js 20.10.0（手动安装）、Java 21（Temurin-21.0.1+12）
 - Ubuntu 22.04、Python 3.10.12（python3 软件包）、Node.js 20.10.0（手动安装）、Java 11（openjdk-11-jre 软件包）

安装依赖：

```sh
npm ci
```

在浏览器中打开 tests/vertical_playground.html 进行开发。对于大多数改动，你不需要重新构建压缩版本。请改为打开 tests/vertical_playground_compressed.html，以测试压缩版本是否构建正确。

要重新构建压缩版本，运行：

```sh
npm run prepublish
```

必须重启 scratch-gui 开发服务器，才能更新已链接的 scratch-blocks。

<!--
#### Scratch Blocks 是一个用于构建创意计算界面的库。
[![CircleCI](https://dl.circleci.com/status-badge/img/gh/LLK/scratch-blocks/tree/develop.svg?style=shield)](https://dl.circleci.com/status-badge/redirect/gh/LLK/scratch-blocks/tree/develop)

![](https://cloud.githubusercontent.com/assets/747641/15227351/c37c09da-1854-11e6-8dc7-9a298f2b1f01.jpg)

<!--
## 简介
Scratch Blocks 是 Google [Blockly](https://github.com/google/blockly) 项目的一个分支，提供了用于构建创意计算界面的设计规范和代码库。它与 [Scratch Virtual Machine (VM)](https://github.com/LLK/scratch-vm) 一起，允许快速设计和开发可视化编程界面。与 [Blockly](https://github.com/google/blockly) 不同，Scratch Blocks 不使用[代码生成器](https://developers.google.com/blockly/guides/configure/web/code-generators)，而是借助 Scratch Virtual Machine 来创建高度动态的交互式编程环境。

*本项目正在积极开发中，目前应被视为"开发者预览"状态。*

## 两类积木
![](https://cloud.githubusercontent.com/assets/747641/15255731/dad4d028-190b-11e6-9c16-8df7445adc96.png)

Scratch Blocks 汇集了 Scratch 团队在过去十年中设计并持续完善的两套不同的编程"语法"。标准的 [Scratch](https://scratch.mit.edu) 语法使用垂直方向咬合的积木，就像乐高积木一样。对于面向更低龄儿童的 [ScratchJr](https://scratchjr.org) 软件，我们开发了以图标而非文字标注、并且水平方向而非垂直方向咬合的积木。我们发现水平语法不仅对初学者更友好，也更适合屏幕较小的设备。

## 文档
包含 [FAQ](https://scratch.mit.edu/developers#faq) 和[设计文档](https://github.com/LLK/scratch-blocks/wiki/Design)在内的"入门"指南可以在 [wiki](https://github.com/LLK/scratch-blocks/wiki) 中找到。

## 捐赠
我们免费提供 [Scratch](https://scratch.mit.edu)，并希望保持免费！请考虑[捐款](https://secure.donationpay.org/scratchfoundation/)以支持我们持续的工程、设计、社区和资源开发工作。任何金额的捐赠我们都感激不尽。谢谢！
-->