import { PacketTypes, decode, encode, peekSize } from "./packet"
import { TimeoutError as PromiseTimeoutError, timeout } from "promise-timeout"
import { Socket, createConnection } from "net"

export class RconError extends Error {
	constructor(message: string) {
		super(message)

		this.name = this.constructor.name
	}
}

export class UnexpectedPacketError extends RconError {
	_packet: any
	_expectedType: any

	constructor(packet: any, expectedType: any) {
		super(`Got unexpected packet ${JSON.stringify(packet)}. Expected ${expectedType}.`)

		this._packet = packet
		this._expectedType = expectedType
	}
}

export class AuthenticationError extends RconError {
	constructor() {
		super("Authentication failed!")
	}
}

export class TimeoutError extends RconError {
	constructor() {
		super("Request timed out.")
	}
}

const newPacket = (size: number) => ({ size, buffer: Buffer.alloc(size == null ? 4 : size), offset: 0 })

class RconClient {
	_callbacks: Map<number, (value: any) => void>
	_socket: Socket
	_timeout: number
	_currentId: number
	_pendingPacket?: any

	constructor(socket: Socket, timeout: number) {
		this._callbacks = new Map()
		this._socket = socket
		this._timeout = timeout
		this._currentId = 0
		this._pendingPacket = null
		this._socket.on("data", this._onReceiveData)
	}

	async authenticate(password: string) {
		const id = this._uniqueId

		this._write({ id, type: PacketTypes.SERVERDATA_AUTH, body: password })

		await Promise.race([this._receive(id), this._receive(-1)])

		// We cannot provide the rest of the implementation of the protocol
		// according to Valve's Wiki page, since some servers do not respond
		// with authentication results at all (e.g. CS:GO: it just accepts faulty
		// passwords but doesn't execute the commands sent).

		// Taking the pragmatic approach, we instead opt to require passwords to be correct.
		// The code below implements the rest of the protocol as described in the wiki page.

		// if (reply.type === Types.SERVERDATA_RESPONSE_VALUE) {
		// 	reply = await Promise.race([this._receive(id), this._receive(-1)])
		// }

		// if (reply.type !== Types.SERVERDATA_AUTH_RESPONSE) {
		// 	throw new UnexpectedPacketError(packet, 'SERVERDATA_AUTH_RESPONSE')
		// }

		// if (reply.id === -1) {
		// 	throw new AuthenticationError()
		// }
	}

	async command(cmd: string) {
		const result = await this._query({ type: PacketTypes.SERVERDATA_EXECCOMMAND, body: cmd })

		if (result.type !== PacketTypes.SERVERDATA_RESPONSE_VALUE) {
			throw new UnexpectedPacketError(result, "SERVERDATA_RESPONSE_VALUE")
		}

		return result.body
	}

	disconnect() {
		return new Promise((resolve) => {
			// @ts-ignore:next-line
			this._socket.end(null, null, resolve)
		})
	}

	_query(packet: any) {
		const id = this._uniqueId

		this._write({ id, ...packet })
		return this._receive(id) as any
	}

	_write(packet: any) {
		this._socket.write(encode(packet))
	}

	async _receive(conversationId: number) {
		try {
			return await timeout(
				new Promise((resolve) => {
					this._callbacks.set(conversationId, resolve)
				}),
				this._timeout
			)
		} catch (err) {
			if (err instanceof PromiseTimeoutError) {
				this._callbacks.delete(conversationId)
				throw new TimeoutError()
			} else {
				throw err
			}
		}
	}

	_onReceivePacket(buf: Buffer) {
		const packet = decode(buf)
		const callback = this._callbacks.get(packet.id as number)

		// If the callback doesn't exist it may be a query that timed out, ignore.
		if (callback) {
			this._callbacks.delete(packet.id as number)
			callback(packet)
		}
	}

	_onReceiveData = (data: Buffer) => {
		let currentOffset = 0

		while (currentOffset < data.length) {
			const packet = this._pendingPacket != null ? this._pendingPacket : newPacket(peekSize(data, currentOffset) || 0)
			const packetEnd = currentOffset + (packet.buffer as Buffer).length - (packet.offset as number)
			const copyUntil = Math.min(packetEnd, data.length)

			data.copy(packet.buffer as Buffer, packet.offset, currentOffset, copyUntil)

			if (packetEnd > data.length) {
				this._pendingPacket = { ...packet, offset: (packet.offset as number) + copyUntil - currentOffset }
			} else {
				this._pendingPacket = null

				if (packet.size == null) {
					this._onReceiveData(packet.buffer)
				} else {
					this._onReceivePacket(packet.buffer)
				}
			}

			currentOffset = copyUntil
		}
	}

	_onSocketError = (err: Error) => {
		throw err
	}

	get _uniqueId() {
		return this._currentId++
	}
}

function connect(host: string, port: number, password: string, timeout = 1000): Promise<RconClient> {
	return new Promise((resolve, reject) => {
		const socket = createConnection({ host, port }, async () => {
			try {
				const client = new RconClient(socket, timeout)
				await client.authenticate(password)

				resolve(client)
			} catch (err) {
				socket.destroy()
				reject(err)
			}
		})

		socket.once("error", reject)
	})
}

export default connect
