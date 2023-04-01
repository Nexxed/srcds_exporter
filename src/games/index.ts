import csgo from "./csgo"
import css from "./css"
import gmod from "./gmod"
import hl2 from "./hl2"
import l4d2 from "./l4d2"
import tf2 from "./tf2"

export interface IRequestInformation {
	ip: string
	port: string
	game: string
}

export default {
	csgo,
	css,
	gmod,
	hl2,
	l4d2,
	tf2
}
