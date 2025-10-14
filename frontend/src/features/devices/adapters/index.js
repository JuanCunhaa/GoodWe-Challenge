// src/features/devices/adapters/index.js
import smartthings from './smartthings.js'
import hue from './hue.js'
import tuya from './tuya.js'

export const adapters = {
  [smartthings.key]: smartthings,
  [hue.key]: hue,
  [tuya.key]: tuya,
}

// Remover Philips Hue da seleção de IoT (permanece disponível no mapa interno se necessário)
export const adapterList = [smartthings, tuya]
