import type { IRequestInformation } from "."
import { metrics } from "../utils/metrics"
import { registries } from "../utils/metrics"

interface RCONResult {
	stats: string
	status: string
}

const formatRconResult = function (result: RCONResult) {
	let { stats, status } = result

	let processedStats = stats.split(/\r?\n/)
	processedStats.shift()
	processedStats = processedStats[0].trim().split(/\s+/)

	const statusLines = status.split(/\r?\n/)
	const processedStatus = {
		hostname: statusLines[0].split(": ").slice(1).join(": "),
		version: statusLines[1].split(": ")[1].split("/")[0],
		map: statusLines[5].split(": ")[1].split(" ")[0]
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
		map: status.map
	}

	registries.tf2Registry.setDefaultLabels(defaultLabels)

	metrics.status.set(Number(1))
	metrics.cpu.set(Number(stats[0]))
	metrics.netin.set(Number(stats[1]))
	metrics.netout.set(Number(stats[2]))
	metrics.uptime.set(Number(stats[3]))
	metrics.maps.set(Number(stats[4]))
	metrics.fps.set(Number(stats[5]))
	metrics.players.set(Number(stats[6]))
	metrics.connects.set(Number(stats[7]))

	return registries.tf2Registry.metrics()
}

const setNoMetrics = function (reqInfos: IRequestInformation) {
	const defaultLabels = {
		server: `${reqInfos.ip}:${reqInfos.port}`,
		game: reqInfos.game
	}

	registries.tf2Registry.setDefaultLabels(defaultLabels)
	metrics.status.set(Number(0))

	return registries.tf2Registry.metrics()
}

const tf2 = {
	setMetrics,
	setNoMetrics
}

export default tf2
