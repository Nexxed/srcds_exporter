import { getSkipStats, setSkipStats } from "./../index"

import { Gauge } from "prom-client"
import type { IRequestInformation } from "."
import { metrics } from "../utils/metrics"
import { registries } from "../utils/metrics"

interface IPlayerStatus {
	userid: string
	name: string
	uniqueid: string
	connected: number
	ping: string
	loss: string
	state: string
	rate: string
	address: string
	port: string
}

interface IPlayerIdentifiers {
	id: string
	name: string
	uniqueid: string
}

interface RCONResult {
	stats: string
	status: string
}

interface IServerMapUpdate {
	value: number
	updated: number
}

const playerRowRegex =
	/^#[ \t]+(?<userid>[0-9]+)[ \t]+(?:.*?)[ \t]+"(?<name>.*?)"[ \t]+(?<uniqueid>STEAM_[10]:[10]:[0-9]+)[ \t]+(?<connected>[0-9]+:[0-9]+)[ \t]+(?<ping>[0-9]+)[ \t]+(?<loss>[0-9]+)[ \t]+(?<state>.*?)[ \t]+(?<rate>[0-9]+)[ \t]+(?<address>.*?):(?<port>[0-9]+)$/

// used for storing player ID's of servers so we can remove stale/disconnected players
const serverPlayers = new Map<string, IPlayerIdentifiers[]>()

// used for storing the date of when a servers' map last updated
const serverMapUpdate = new Map<string, IServerMapUpdate>()

const formatRconResult = function (result: RCONResult) {
	const { stats, status } = result

	let processedStats = stats.split(/\r?\n/)
	processedStats.pop()
	processedStats.shift()
	processedStats = processedStats[0]?.trim().split(/\s+/)

	const statusLines = status.split(/\r?\n/)
	const processedPlayers = statusLines
		.slice(
			statusLines.findIndex((row) => row.startsWith("# userid")) + 1,
			statusLines.findIndex((row) => row === "#end")
		)
		.map((row) => {
			// parse the player row and match the data we need
			const matches = row.match(playerRowRegex)
			if (!matches || !matches.groups) return false

			// extract each column value from the matches and assign it to a fresh object
			const obj = {} as any
			Object.assign(obj, matches.groups)

			// parse the connected time of a player to seconds
			const connectedParts: string[] = obj.connected.split(":")

			// calculate seconds based on how many parts there are
			// hours: 00:00:00, minutes: 00:00, seconds: 00

			// TODO: find a better way to do this
			if (connectedParts.length === 3) {
				obj.connected = Number(connectedParts[0]) * 60 * 60 + Number(connectedParts[1]) * 60 + Number(connectedParts[2])
			} else if (connectedParts.length === 2) {
				obj.connected = Number(connectedParts[0]) * 60 + Number(connectedParts[1])
			} else if (connectedParts.length === 1) {
				obj.connected = Number(connectedParts[0])
			}

			obj.connected = Number(connectedParts[0]) * 60 + Number(connectedParts[1])

			return obj as IPlayerStatus
		})
		.filter((r) => r) as IPlayerStatus[]

	const processedStatus = {
		hostname: statusLines[0].split(": ").slice(1).join(": "),
		version: statusLines[1].split(": ")[1].split("/")[0],
		listenAddress: statusLines[2].split(": ")[1].split("  ")[0],
		os: statusLines[3].split(":  ")[1],
		type: statusLines[4].split(":  ")[1],
		map: statusLines[5].split(": ")[1],
		hibernating: statusLines[6].indexOf("(hibernating)") > -1,
		maxplayers: (statusLines[6].match(/\((.*)\/.* max\)/) ?? ["", 0])[1],

		players: processedPlayers
	}

	return {
		stats: processedStats,
		status: processedStatus
	}
}

const setMetrics = function (result: RCONResult, reqInfos: IRequestInformation) {
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

	registries.csgoRegistry.setDefaultLabels(defaultLabels)
	metrics.status.set(status.hibernating ? 2 : 1)

	// if a stats object exists
	if (stats.length > 0) {
		const gaugeValues = {
			cpu: Number(stats[0]),
			netin: Number(stats[1]),
			netout: Number(stats[2]),
			uptime: Number(stats[3]),
			maps: Number(stats[4]),
			fps: Number(stats[5]),
			players: Number(stats[6]),
			maxplayers: Number(status.maxplayers),
			svms: Number(stats[7]),
			varms: Number(stats[8]),
			tick: Number(stats[9])
		} as { [key: string]: number }

		for (const gaugeName of Object.keys(gaugeValues)) {
			;(metrics as { [key: string]: Gauge })[gaugeName].set(gaugeValues[gaugeName])
		}

		// get whether or not we're currently skipping the stats command for this server
		const skippingStats = getSkipStats(defaultLabels.server)

		// get when and what the server last updated the "maps" value to
		const lastMapUpdate = serverMapUpdate.get(defaultLabels.server)

		// if we're not skipping the stats command and the values have changed
		if (!skippingStats && gaugeValues.maps !== lastMapUpdate?.value) {
			const now = Date.now()

			// start skipping the stats
			setSkipStats(defaultLabels.server, true)

			// set the servers' last map update
			serverMapUpdate.set(defaultLabels.server, { value: gaugeValues.maps, updated: now })

			// wait 15 seconds before updating stats
			setTimeout(() => {
				// skip if the map updated during the timeout
				if (serverMapUpdate.get(defaultLabels.server)?.updated !== now) return

				// stop skipping the stats command for this server
				setSkipStats(defaultLabels.server, false)
			}, 15_000)
		}
	}

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
	return registries.csgoRegistry.metrics()
}

const setNoMetrics = function (reqInfos: IRequestInformation) {
	const defaultLabels = {
		server: `${reqInfos.ip}:${reqInfos.port}`,
		game: reqInfos.game
	}

	registries.csgoRegistry.setDefaultLabels(defaultLabels)
	metrics.status.set(Number(0))

	return registries.csgoRegistry.metrics()
}

export default {
	setMetrics,
	setNoMetrics
}
