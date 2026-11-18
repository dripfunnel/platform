'use client'

import { motion } from 'motion/react'

export const Bad = ({ frames }: { frames: () => { x: number } }) => {
  return <motion.div animate={frames}>Hello</motion.div>
}
