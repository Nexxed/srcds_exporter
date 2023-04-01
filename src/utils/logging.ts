import { Logger, pino } from "pino"

let logger: Logger
if (process.env.NODE_ENV === "development") {
	logger = pino({
		level: "debug",
		transport: {
			target: "pino-pretty",
			options: {
				colorize: true
			}
		}
	})
} else {
	logger = pino()
}

export default logger
