import Graph from "graphology";
import forceLayout from "graphology-layout-force";
import Sigma from "sigma";

const graphContainer = document.querySelector("#graph-container");
const stats = document.querySelector("#graph-stats");
const emptyState = document.querySelector("#empty-state");
const messages = document.querySelector("#messages");
const input = document.querySelector("#text-input");
const askButton = document.querySelector("#ask-button");
const ingestButton = document.querySelector("#ingest-button");

const GRAPH_LIMIT = 150;
const NODE_COLORS = {
	screen: "#38bdf8",
	ui_section: "#2dd4bf",
	ui_field: "#a78bfa",
	integration_api: "#f59e0b",
	external_system: "#fb7185",
	functionality_feature: "#84cc16",
	system_logic: "#f472b6",
	concept: "#94a3b8",
};

let graphState = { nodes: [], relations: [] };
let graphologyGraph = new Graph({ multi: true, type: "directed" });
let renderer = null;
let draggedNode = null;
let resultNodeIds = new Set();
let resultRelationIds = new Set();
let hoveredNodeId = null;
let pinnedNodeId = null;
let edgeEndpointById = new Map();

function truncate(value, length = 34) {
	const text = String(value ?? "");
	return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function typeColor(type) {
	return NODE_COLORS[type] ?? NODE_COLORS.concept;
}

function relationLabel(relation) {
	return String(relation ?? "relates_to").replaceAll("_", " ");
}

function getGraphSize() {
	const rect = graphContainer.getBoundingClientRect();
	return {
		width: Math.max(rect.width, 320),
		height: Math.max(rect.height, 320),
	};
}

function initialPosition(index, total) {
	const { width, height } = getGraphSize();
	const centerX = width / 2;
	const centerY = height / 2;
	const radius = Math.min(width, height) * 0.34;
	const scale = 1 / Math.max(width, height);
	const angle = (index / Math.max(total, 1)) * Math.PI * 2;

	return {
		x: (Math.cos(angle) * radius) * scale,
		y: (Math.sin(angle) * radius) * scale,
	};
}

function createGraphologyGraph(graph) {
	const nextGraph = new Graph({ multi: true, type: "directed" });
	for (const [index, node] of graph.nodes.entries()) {
		const position = initialPosition(index, graph.nodes.length);
		nextGraph.addNode(node.id, {
			x: position.x,
			y: position.y,
			size: 8,
			label: truncate(node.label, 42),
			color: typeColor(node.type),
			fullLabel: node.label,
			kgType: node.type,
			description: node.description,
		});
	}

	edgeEndpointById = new Map();
	for (const relation of graph.relations) {
		if (!nextGraph.hasNode(relation.sourceId) || !nextGraph.hasNode(relation.targetId)) {
			continue;
		}

		edgeEndpointById.set(relation.id, {
			sourceId: relation.sourceId,
			targetId: relation.targetId,
		});
		nextGraph.mergeDirectedEdgeWithKey(relation.id, relation.sourceId, relation.targetId, {
			size: 1.4,
			label: truncate(relationLabel(relation.relation), 24),
			color: "#65758a",
			information: relation.information,
		});
	}

	forceLayout.assign(nextGraph, {
		maxIterations: graph.nodes.length > 90 ? 220 : 320,
		settings: {
			attraction: 0.0008,
			repulsion: 0.18,
			gravity: 0.04,
			inertia: 0.6,
			maxMove: 12,
		},
	});

	return nextGraph;
}

function getFocusNodeIds() {
	const focus = new Set(resultNodeIds);
	const activeNodeId = pinnedNodeId || hoveredNodeId;

	if (activeNodeId && graphologyGraph.hasNode(activeNodeId)) {
		focus.add(activeNodeId);
		for (const neighbor of graphologyGraph.neighbors(activeNodeId)) {
			focus.add(neighbor);
		}
	}

	return focus;
}

function isFocusedEdge(edge) {
	if (resultRelationIds.has(edge)) {
		return true;
	}

	const activeNodeId = pinnedNodeId || hoveredNodeId;
	const endpoints = edgeEndpointById.get(edge);
	return Boolean(activeNodeId && endpoints && (
		endpoints.sourceId === activeNodeId || endpoints.targetId === activeNodeId
	));
}

function drawDarkNodeHover(context, data, settings) {
	const size = settings.labelSize;
	const font = settings.labelFont;
	const weight = settings.labelWeight;
	const padding = 5;
	const label = typeof data.label === "string" ? data.label : "";

	context.font = `${weight} ${size}px ${font}`;
	context.shadowOffsetX = 0;
	context.shadowOffsetY = 0;
	context.shadowBlur = 12;
	context.shadowColor = "rgba(0, 0, 0, 0.45)";
	context.fillStyle = "#111827";

	if (label) {
		const textWidth = context.measureText(label).width;
		const boxWidth = Math.round(textWidth + 12);
		const boxHeight = Math.round(size + padding * 2);
		const radius = Math.max(data.size, size / 2) + padding;
		const angleRadian = Math.asin(boxHeight / 2 / radius);
		const xDeltaCoord = Math.sqrt(Math.abs(radius ** 2 - (boxHeight / 2) ** 2));

		context.beginPath();
		context.moveTo(data.x + xDeltaCoord, data.y + boxHeight / 2);
		context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2);
		context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2);
		context.lineTo(data.x + xDeltaCoord, data.y - boxHeight / 2);
		context.arc(data.x, data.y, radius, angleRadian, -angleRadian);
		context.closePath();
		context.fill();
	} else {
		context.beginPath();
		context.arc(data.x, data.y, data.size + padding, 0, Math.PI * 2);
		context.closePath();
		context.fill();
	}

	context.shadowBlur = 0;
	context.fillStyle = data.color || "#2dd4bf";
	context.beginPath();
	context.arc(data.x, data.y, data.size, 0, Math.PI * 2);
	context.closePath();
	context.fill();

	if (label) {
		context.fillStyle = "#f8fafc";
		context.fillText(label, data.x + data.size + 9, data.y + size / 3);
	}
}

function syncHighlightSettings() {
	if (!renderer) {
		return;
	}

	const focusNodeIds = getFocusNodeIds();
	const hasFocus = focusNodeIds.size > 0;

	renderer.setSetting("nodeReducer", (node, data) => {
		const isFocused = focusNodeIds.has(node);

		if (!hasFocus) {
			return data;
		}

		return {
			...data,
			color: isFocused ? "#f6ad55" : "#475569",
			size: isFocused ? (data.size ?? 8) + 3 : Math.max((data.size ?? 8) - 2, 3),
			highlighted: isFocused,
			label: isFocused ? data.label : "",
		};
	});
	renderer.setSetting("edgeReducer", (edge, data) => {
		const isFocused = isFocusedEdge(edge);

		if (!hasFocus) {
			return data;
		}

		return {
			...data,
			color: isFocused ? "#f6ad55" : "#334155",
			size: isFocused ? (data.size ?? 1.4) + 1.1 : 0.6,
			label: isFocused ? data.label : "",
		};
	});
	renderer.refresh();
}

function bindInteractionHandlers() {
	renderer.on("enterNode", (event) => {
		hoveredNodeId = event.node;
		syncHighlightSettings();
	});

	renderer.on("leaveNode", () => {
		hoveredNodeId = null;
		syncHighlightSettings();
	});

	renderer.on("clickNode", (event) => {
		pinnedNodeId = pinnedNodeId === event.node ? null : event.node;
		event.preventSigmaDefault();
		syncHighlightSettings();
	});

	renderer.on("clickStage", () => {
		pinnedNodeId = null;
		syncHighlightSettings();
	});

	renderer.on("downNode", (event) => {
		draggedNode = event.node;
		event.preventSigmaDefault();
		renderer.setSetting("enableCameraPanning", false);
	});

	renderer.getMouseCaptor().on("mousemovebody", (event) => {
		if (!draggedNode) {
			return;
		}

		const position = renderer.viewportToGraph({ x: event.x, y: event.y });
		graphologyGraph.mergeNodeAttributes(draggedNode, position);
		renderer.refresh({ partialGraph: { nodes: [draggedNode] }, skipIndexation: true });
	});

	renderer.getMouseCaptor().on("mouseup", () => {
		if (!draggedNode) {
			return;
		}

		draggedNode = null;
		renderer.setSetting("enableCameraPanning", true);
		renderer.refresh();
	});
}

function renderGraph(graph) {
	graphState = {
		nodes: graph.nodes ?? [],
		relations: graph.relations ?? [],
	};
	stats.textContent = `${graphState.nodes.length} nodes / ${graphState.relations.length} relations`;
	emptyState.hidden = graphState.nodes.length > 0;

	graphologyGraph = createGraphologyGraph(graphState);

	if (renderer) {
		renderer.kill();
		renderer = null;
	}

	graphContainer.replaceChildren();

	if (graphState.nodes.length === 0) {
		resultNodeIds = new Set();
		resultRelationIds = new Set();
		hoveredNodeId = null;
		pinnedNodeId = null;
		return;
	}

	renderer = new Sigma(graphologyGraph, graphContainer, {
		allowInvalidContainer: true,
		autoCenter: true,
		autoRescale: true,
		defaultEdgeColor: "#65758a",
		defaultEdgeType: "arrow",
		defaultNodeColor: "#94a3b8",
		defaultDrawNodeHover: drawDarkNodeHover,
		enableEdgeEvents: true,
		labelColor: { color: "#edf2f7" },
		labelDensity: 0.12,
		labelRenderedSizeThreshold: 6,
		labelSize: 12,
		renderEdgeLabels: true,
		edgeLabelColor: { color: "#f6ad55" },
		edgeLabelSize: 10,
		hideEdgesOnMove: false,
		hideLabelsOnMove: false,
	});
	bindInteractionHandlers();
	syncHighlightSettings();
}

function appendMessage(role, content, options = {}) {
	const message = document.createElement("article");
	message.className = `message ${role}${options.error ? " error" : ""}`;
	const bubble = document.createElement("div");
	bubble.className = "bubble";

	if (content instanceof Node) {
		bubble.append(content);
	} else {
		bubble.textContent = content;
	}

	message.append(bubble);
	messages.append(message);
	messages.scrollTop = messages.scrollHeight;
	return message;
}

function buildTripletContent(triplets) {
	const container = document.createElement("div");
	const summary = document.createElement("div");
	summary.textContent = triplets.length === 0
		? "Ingest complete, but no relations were extracted."
		: `Ingest complete. Extracted ${triplets.length} triplet${triplets.length === 1 ? "" : "s"}.`;
	container.append(summary);

	if (triplets.length > 0) {
		const list = document.createElement("div");
		list.className = "triplet-list";
		for (const triplet of triplets) {
			const row = document.createElement("div");
			row.className = "triplet";
			const source = document.createElement("strong");
			const relation = document.createTextNode(` ${relationLabel(triplet.relation)} `);
			const target = document.createElement("strong");
			source.textContent = triplet.sourceLabel;
			target.textContent = triplet.targetLabel;
			row.append(source, relation, target);
			if (triplet.information) {
				const info = document.createElement("div");
				info.textContent = triplet.information;
				row.append(info);
			}
			list.append(row);
		}
		container.append(list);
	}

	return container;
}

function setBusy(isBusy) {
	askButton.disabled = isBusy;
	ingestButton.disabled = isBusy;
	input.disabled = isBusy;
}

async function requestJson(url, options = {}) {
	const response = await fetch(url, {
		headers: { "content-type": "application/json" },
		...options,
	});
	const body = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(body.error || `Request failed with status ${response.status}.`);
	}

	return body;
}

async function loadGraph() {
	stats.textContent = "Loading...";
	try {
		const graph = await requestJson(`/api/graph?limit=${GRAPH_LIMIT}`);
		resultNodeIds = new Set();
		resultRelationIds = new Set();
		hoveredNodeId = null;
		pinnedNodeId = null;
		renderGraph(graph);
	} catch (error) {
		stats.textContent = "Unavailable";
		appendMessage("assistant", error.message, { error: true });
	}
}

function highlightAskEntryNodes(entryNodes) {
	resultNodeIds = new Set((entryNodes ?? []).map((node) => node.id));
	resultRelationIds = new Set();
	pinnedNodeId = null;
	syncHighlightSettings();
}

async function runAction(action) {
	const text = input.value.trim();
	if (!text) {
		appendMessage("assistant", "Enter text before choosing Ask or Ingest.", { error: true });
		return;
	}

	appendMessage("user", text);
	input.value = "";
	setBusy(true);
	const pending = appendMessage("assistant", action === "ask" ? "Thinking..." : "Extracting graph facts...");

	try {
		if (action === "ask") {
			const result = await requestJson("/api/ask", {
				method: "POST",
				body: JSON.stringify({ text }),
			});
			pending.querySelector(".bubble").textContent = result.answer || "The graph does not contain enough information yet.";
			highlightAskEntryNodes(result.entryNodes);
			return;
		}

		const result = await requestJson("/api/ingest", {
			method: "POST",
			body: JSON.stringify({ text }),
		});
		pending.querySelector(".bubble").replaceChildren(buildTripletContent(result.triplets ?? []));
		resultNodeIds = new Set((result.nodes ?? []).map((node) => node.id));
		resultRelationIds = new Set((result.relations ?? []).map((relation) => relation.id));
		pinnedNodeId = null;
		renderGraph(result.graph ?? { nodes: [], relations: [] });
	} catch (error) {
		pending.classList.add("error");
		pending.querySelector(".bubble").textContent = error.message;
	} finally {
		setBusy(false);
		input.focus();
	}
}

askButton.addEventListener("click", () => runAction("ask"));
ingestButton.addEventListener("click", () => runAction("ingest"));

document.querySelector("#composer").addEventListener("submit", (event) => {
	event.preventDefault();
});

input.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		runAction("ask");
	}
});

window.addEventListener("resize", () => {
	if (renderer) {
		renderer.resize();
		renderer.refresh();
	}
});

loadGraph();
