const { csgoRegistry } = require("../utils/metrics.js").registries

const { metrics } = require("../utils/metrics.js")

const playerRowRegex =
	/^#[ \t]+(?<userid>[0-9]+)[ \t]+(?:.*?)[ \t]+"(?<name>.*?)"[ \t]+(?<uniqueid>STEAM_[10]:[10]:[0-9]+)[ \t]+(?<connected>[0-9]+:[0-9]+)[ \t]+(?<ping>[0-9]+)[ \t]+(?<loss>[0-9]+)[ \t]+(?<state>.*?)[ \t]+(?<rate>[0-9]+)[ \t]+(?<address>.*?):(?<port>[0-9]+)$/

// used for storing player ID's of servers so we can remove stale/disconnected players
const serverPlayers = new Map()

const formatRconResult = function (result) {
	let { stats, status } = result

	stats = stats.split(/\r?\n/)
	stats.pop()
	stats.shift()
	stats = stats[0].trim().split(/\s+/)

	const infosArray = status.split(/\r?\n/)

	status = {
		hostname: infosArray[0].split(": ").slice(1).join(": "),
		version: infosArray[1].split(": ")[1].split("/")[0],
		listenAddress: infosArray[2].split(": ")[1].split("  ")[0],
		os: infosArray[3].split(":  ")[1],
		type: infosArray[4].split(":  ")[1],
		map: infosArray[5].split(": ")[1],

		players: infosArray
			.slice(
				infosArray.findIndex((row) => row.startsWith("# userid")) + 1,
				infosArray.findIndex((row) => row === "#end")
			)
			.map((row) => {
				const matches = row.match(playerRowRegex)
				if (!matches || !matches.groups) return false

				const obj = {}
				Object.assign(obj, matches.groups)
				return obj
			})
			.filter((r) => r)
	}

	return {
		stats,
		status
	}
}

const setMetrics = function (result, reqInfos) {
	const { stats, status } = formatRconResult(result)

	const defaultLabels = {
		server: `${reqInfos.ip}:${reqInfos.port}`,
		game: reqInfos.game,
		version: status.version,
		hostname: status.hostname,
		map: status.map,
		os: status.os,
		type: status.type
	}

	csgoRegistry.setDefaultLabels(defaultLabels)

	metrics.status.set(Number(1))
	metrics.cpu.set(Number(stats[0]))
	metrics.netin.set(Number(stats[1]))
	metrics.netout.set(Number(stats[2]))
	metrics.uptime.set(Number(stats[3]))
	metrics.maps.set(Number(stats[4]))
	metrics.fps.set(Number(stats[5]))
	metrics.players.set(Number(stats[6]))
	metrics.svms.set(Number(stats[7]))
	metrics.varms.set(Number(stats[8]))
	metrics.tick.set(Number(stats[9]))

	// get all players from the previous fetch for this server
	const previousPlayers = serverPlayers.get(defaultLabels.server) ?? []

	// filter the last fetch and find players that do not exist in the latest fetch
	const disconnectedPlayers = previousPlayers.filter((identifiers) => !status.players.find((player) => player.uniqueid === identifiers.uniqueid))

	// go through each disconnected players' identifiers and remove the metrics for them
	for (const playerIdentifiers of disconnectedPlayers) {
		const values = Object.values(playerIdentifiers)
		metrics.player_ping.remove(...values)
		metrics.player_loss.remove(...values)
		metrics.player_rate.remove(...values)
	}

	const playerIdentifiers = []
	for (const player of status.players) {

		// form an object of the players' identifiers
		const identifiers = { id: player.userid, name: player.name, uniqueid: player.uniqueid }

		// update the metrics for this set of identifiers
		metrics.player_ping.set(identifiers, Number(player.ping))
		metrics.player_loss.set(identifiers, Number(player.loss))
		metrics.player_rate.set(identifiers, Number(player.rate))

		// push this players' identifiers to an array
		playerIdentifiers.push(identifiers)
	}

	// set the players map for this server to the player identifiers object
	serverPlayers.set(defaultLabels.server, playerIdentifiers)
	return csgoRegistry.metrics()
}

setNoMetrics = function (reqInfos) {
	const defaultLabels = {
		server: `${reqInfos.ip}:${reqInfos.port}`,
		game: reqInfos.game
	}

	csgoRegistry.setDefaultLabels(defaultLabels)
	metrics.status.set(Number(0))

	return csgoRegistry.metrics()
}

module.exports = {
	setMetrics,
	setNoMetrics
}
