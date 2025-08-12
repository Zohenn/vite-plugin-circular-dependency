import chalk from 'chalk';
import { writeFileSync } from 'node:fs';
import { createFilter } from '@rollup/pluginutils';
import { join, relative } from 'node:path';

class ModuleNode {
    moduleId;
    importerModuleIds;
    children = null;
    constructor(moduleId, importerModuleIds) {
        this.moduleId = moduleId;
        this.importerModuleIds = importerModuleIds;
    }
}

/** Get all imported module ids of the module */
function getModuleImportIds(moduleInfo, ctx) {
    const { importedIds, dynamicallyImportedIds } = moduleInfo;
    return ctx.ignoreDynamicImport
        ? importedIds
        : [...importedIds, ...dynamicallyImportedIds];
}
/** Factory function to generate module nodes */
function generateModuleNode(moduleInfo, ctx) {
    const importerModuleIds = getModuleImportIds(moduleInfo, ctx);
    const { id } = moduleInfo;
    return new ModuleNode(id, importerModuleIds);
}
function initRootModuleId() {
    let rootModuleId;
    return {
        getRootModuleId() {
            return rootModuleId;
        },
        setRootModuleId(moduleId) {
            if (!rootModuleId) {
                rootModuleId = moduleId;
            }
        },
    };
}

/** Generate the dependency tree of modules */
function generateModuleTree(rootModuleNode, moduleIdNodeMap) {
    const moduleNodeCreatedSet = new Set();
    /** Get child module nodes of a specific module */
    function getModuleChildNodes(node) {
        const { importerModuleIds } = node;
        return importerModuleIds
            .map((moduleId) => moduleIdNodeMap.get(moduleId))
            .filter(Boolean);
    }
    /** Depth-first traversal to generate the module dependency tree */
    function recursionBuild(node) {
        // Add the current node to the created set to avoid self-referencing
        moduleNodeCreatedSet.add(node.moduleId);
        // Get child module nodes
        const childNodes = getModuleChildNodes(node);
        childNodes.forEach((childNode) => {
            // If the current subtree is not generated, continue recursion
            if (!moduleNodeCreatedSet.has(childNode.moduleId)) {
                recursionBuild(childNode);
            }
            // Associate the current subtree with the parent node
            if (!node.children) {
                node.children = new Set();
            }
            node.children.add(childNode);
        });
    }
    recursionBuild(rootModuleNode);
}
/** Generate a map of nodes that form cycles */
function generateCircleNodeMap(rootModuleNode) {
    // Map to store nodes with circular dependencies found during traversal
    const circleNodesMap = new Map();
    // Set to store nodes that have been DFS traversed to avoid re-traversal
    const visitedNodeIdSet = new Set();
    /** Depth-first traversal of the tree, recording nodes along the way. If a node is found in the path, it indicates a cycle */
    function depthFirstTraversal(node, visitPathSet) {
        const { moduleId, children } = node;
        // End if already visited
        if (visitedNodeIdSet.has(moduleId)) {
            return;
        }
        // Add the current node to the path to avoid self-referencing
        visitPathSet.add(moduleId);
        children?.forEach((childNode) => {
            const { moduleId: childModuleId } = childNode;
            if (visitPathSet.has(childModuleId)) {
                insertCircleNodesToMap(generateCircleNodes(childNode, visitPathSet), circleNodesMap);
                return;
            }
            else {
                depthFirstTraversal(childNode, visitPathSet);
            }
        });
        visitedNodeIdSet.add(moduleId);
        // Remove the current node from the path
        visitPathSet.delete(moduleId);
    }
    depthFirstTraversal(rootModuleNode, new Set());
    return circleNodesMap;
}
/** Generate all nodes on the cycle of a specific node */
function generateCircleNodes(node, visitPathSet) {
    const result = [];
    let currentNode = node;
    do {
        result.push(currentNode);
        if (!currentNode.children) {
            break;
        }
        currentNode = Array.from(currentNode.children).find((item) => visitPathSet.has(item.moduleId) && !result.includes(item));
    } while (currentNode && currentNode !== node);
    return result;
}
/** Insert cycle nodes into the map */
function insertCircleNodesToMap(circleNodes, circleNodesMap) {
    const sortedCircleNodes = circleNodes.sort((pre, next) => pre.moduleId < next.moduleId ? -1 : 1);
    const circleId = sortedCircleNodes.map((item) => item.moduleId).join("-");
    circleNodesMap.set(circleId, sortedCircleNodes);
}

var Template = "<!DOCTYPE html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\">\n    <title>Dependency Graph with Vis.js</title>\n    <style>\n      #network {\n        width: 100%;\n        height: 600px;\n      }\n    </style>\n    <script src=\"https://unpkg.com/vis-network/standalone/umd/vis-network.min.js\"></script>\n  </head>\n  <body>\n    <div id=\"network\"></div>\n    <script>\n      const transformJson = (input) => {\n        const output = {};\n        for (const key in input) {\n          const dependencies = input[key];\n          const transformedDependencies = dependencies.map((depArray) => {\n            return [...depArray, key];\n          });\n          output[key] = transformedDependencies;\n        }\n        return output;\n      };\n      const originData = {{DATA}}\n      const data = transformJson(originData);\n\n      const nodes = new Set();\n      const edges = [];\n\n      // 处理数据，构建节点和边\n      for (const key in data) {\n        data[key].forEach((linkArray) => {\n          for (let i = 0; i < linkArray.length - 1; i++) {\n            edges.push({ from: linkArray[i], to: linkArray[i + 1] });\n            nodes.add(linkArray[i]);\n            nodes.add(linkArray[i + 1]);\n          }\n        });\n      }\n\n      const nodesArray = Array.from(nodes).map((node) => {\n        const fileName = node.split(\"/\").pop(); // 获取文件名\n        return { id: node, label: fileName, title: node }; // 设置悬浮显示完整路径\n      });\n\n      // 创建网络图\n      const container = document.getElementById(\"network\");\n      const dataVis = {\n        nodes: new vis.DataSet(nodesArray),\n        edges: new vis.DataSet(edges),\n      };\n      const options = {\n        physics: true,\n        manipulation: {\n          enabled: false,\n        },\n        nodes: {\n          // 添加节点形状设置\n          shape: \"dot\", // 设置节点为圆形\n          size: 8, // 设置节点大小\n        },\n        edges: {\n          arrows: {\n            to: { enabled: true, scaleFactor: 1, type: \"arrow\" }, // 添加箭头\n          },\n        },\n      };\n      const network = new vis.Network(container, dataVis, options);\n    </script>\n  </body>\n</html>\n";

const replaceDataPlaceholder = (data) => {
    return Template.replace("{{DATA}}", JSON.stringify(data));
};
const writeDataToInteractiveFile = (data, filePath) => {
    const result = replaceDataPlaceholder(data);
    writeFileSync(filePath, result, "utf-8");
};

/** handle circle nodes */
function processCircleNodes(ctx, circleNodesMap) {
    const data = formatData(ctx, circleNodesMap);
    outputCircleData(ctx, data);
    validateCircleData(ctx, data);
}
function validateCircleData(ctx, data) {
    if (ctx.circleImportThrowErr && Object.keys(data).length) {
        throw new Error("has circular dependencies in this project");
    }
}
function formatData(ctx, data) {
    const moduleNodeIDs = transformNodeData(ctx, filterNodes(data));
    const groupedNodeIDs = groupByFirstNodePath(moduleNodeIDs);
    return ctx.formatOut(groupedNodeIDs);
}
function filterNodes(circleNodesMap) {
    return Array.from(circleNodesMap.values()).filter((item) => item.length);
}
function transformNodeData(ctx, data) {
    return data.map((nodeArr) => nodeArr.map((item) => ctx.formatOutModulePath(item.moduleId)));
}
function groupByFirstNodePath(data) {
    return data.reduce((pre, curNodes) => {
        const firstNodeId = curNodes[0];
        if (!pre[firstNodeId]) {
            pre[firstNodeId] = [];
        }
        pre[firstNodeId].push(curNodes);
        return pre;
    }, {});
}
function outputCircleData(ctx, data) {
    const { outputFilePath, outputInteractiveFilePath } = ctx;
    outputFilePath ? outputToFile(ctx, data) : consolePrint(ctx, data);
    if (outputInteractiveFilePath) {
        writeDataToInteractiveFile(data, outputInteractiveFilePath);
    }
}
function outputToFile(ctx, data) {
    writeFileSync(ctx.outputFilePath, JSON.stringify(data, null, "\t"));
}
function consolePrint(ctx, data) {
    Object.entries(data).forEach((item) => {
        const [entryModuleId, moduleNodes] = item;
        console.group();
        console.log("\n\n" + chalk.yellow(ctx.formatOutModulePath(entryModuleId)));
        moduleNodes.forEach((currentCir) => {
            console.log("\t" +
                currentCir.map((node) => chalk.red(node)).join(chalk.blue(" -> ")));
        });
        console.groupEnd();
    });
}

function createContext(options) {
    const formattedOptions = formatOptions(options);
    const { ignoreModuleIdSet, processIgnore } = initIgnoreModule();
    const { include, exclude } = formattedOptions;
    const rollupFilter = createFilter(include, exclude);
    const filter = (id) => rollupFilter(id) && !ignoreModuleIdSet.has(id);
    const { getRootModuleNode, handleLoadModule, moduleIdNodeMap } = initModule();
    return {
        ...formattedOptions,
        filter,
        getRootModuleNode,
        handleLoadModule,
        processIgnore,
        moduleIdNodeMap,
    };
}
function formatOptions(options) {
    let { include = [/\.[jt]sx?$/, /\.vue$/, /\.vue\?vue/, /\.svelte$/], exclude = [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/], outputFilePath = "", outputInteractiveFilePath = "", circleImportThrowErr = true, formatOutModulePath, formatOut, ignoreDynamicImport = false, } = options ?? {};
    if (outputFilePath) {
        outputFilePath = join(process.cwd(), outputFilePath);
    }
    return {
        include,
        exclude,
        outputFilePath,
        outputInteractiveFilePath,
        circleImportThrowErr,
        ignoreDynamicImport,
        formatOutModulePath: formatOutModulePath ?? defaultFormatOutModulePath,
        formatOut: formatOut ?? defaultFormatOut,
    };
}
function defaultFormatOutModulePath(path) {
    return relative(process.cwd(), path);
}
function defaultFormatOut(data) {
    return data;
}
function initModule() {
    const { getRootModuleId, setRootModuleId } = initRootModuleId();
    const moduleIdNodeMap = new Map();
    return {
        getRootModuleNode: () => moduleIdNodeMap.get(getRootModuleId()),
        handleLoadModule: setRootModuleId,
        moduleIdNodeMap,
    };
}
function initIgnoreModule() {
    const ignoreFileReg = /@circular-ignore/gi;
    const ignoreFilter = (code) => ignoreFileReg.test(code);
    const ignoreModuleIdSet = new Set();
    const processIgnore = (moduleId, code) => {
        if (ignoreFilter(code)) {
            ignoreModuleIdSet.add(moduleId);
        }
    };
    return {
        ignoreModuleIdSet,
        processIgnore,
    };
}

var index = (options) => {
    const ctx = createContext(options);
    const { filter, getRootModuleNode, handleLoadModule, moduleIdNodeMap, processIgnore, } = ctx;
    return {
        name: "vite-plugin-circular-dependency",
        enforce: "pre",
        load: (id) => {
            if (!filter(id)) {
                return;
            }
            handleLoadModule(id);
        },
        transform(code, id) {
            processIgnore(id, code);
        },
        moduleParsed: (moduleInfo) => {
            const { id } = moduleInfo;
            if (!filter(id)) {
                return;
            }
            const moduleNode = generateModuleNode(moduleInfo, ctx);
            moduleIdNodeMap.set(moduleInfo.id, moduleNode);
        },
        generateBundle() {
            const rootModuleNode = getRootModuleNode();
            if (!rootModuleNode) {
                console.error("Failed to generate entry module");
                return;
            }
            /** generate module dependency tree */
            generateModuleTree(rootModuleNode, moduleIdNodeMap);
            /** generate a map of circle nodes */
            const circleNodeMap = generateCircleNodeMap(rootModuleNode);
            processCircleNodes(ctx, circleNodeMap);
        },
    };
};

export { index as default };
