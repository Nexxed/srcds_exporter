import * as dotenv from "dotenv"

import Fastify from "fastify"
import connect from "./lib/rcon"
import fs from "fs"
import games from "./games"
import logger from "./utils/logging"
import schema from "./utils/schema"

dotenv.config()

const server = Fastify()
const gameKeys = Object.keys(games)

// this is how we control whether or not to skip the stats command for when the map changes
let skipStats = new Map<string, boolean>()

// these functions are called by game modules
export const getSkipStats = (server: string) => skipStats.get(server) ?? false
export const setSkipStats = (server: string, value: boolean) => skipStats.set(server, value)

server.get("/", (req, res) => {
	res.type("text/html").send(fs.readFileSync(__dirname + "/../static/homepage.html"))
})

server.get("/metrics", { schema }, async (req, res) => {
	// parse the query paramters
	const { ip, port, password, game } = req.query as { ip: string; port: string; password: string; game: string }
	if (!gameKeys.includes(game)) return res.status(400).send(`Invalid game provided! Available games: ${gameKeys.join(", ")}`)

	try {
		const client = await connect(ip, Number(port), password, 5 * 1000)

		const status = await client.command("status")
		const stats = await client.command("stats")

		await client.disconnect()
		const response = (games as { [key: string]: any })[game].setMetrics({ stats, status }, { ip, port, game })

		res.type("text/plain").send(response)
	} catch (err) {
		logger.error({ step: "FETCH_METRICS", err }, "error while fetching metrics from server")
		const response = (games as { [key: string]: any })[game].setNoMetrics({ ip, port, game })
		res.type("text/plain").send(response)
	}
})

process.env.HTTP_PORT ??= "9591"
server.listen({ port: Number(process.env.HTTP_PORT) }, (err, address) => {
	if (err) {
		logger.fatal({ step: "LISTEN", err }, `An error occurred while binding the metrics server to ${address}`)
		process.exit(1)
	}

	logger.info(`Metrics server listening on ${address}`)
})

process.on("uncaughtException", (err) => {
	logger.error({ step: "UNCAUGHT_EXCEPTION", err: err.message }, "uncaught exception")
})
