"""Render LINK's original notification melodies to local 16-bit mono WAV files."""
from array import array
from math import exp, sin, tau
from pathlib import Path
import sys
import wave


def chime(time, frequency, duration):
    attack = min(1, time / .017)
    release = min(1, (duration - time) / .08)
    phase = tau * frequency * time
    fundamental = sin(phase) + .09 * sin(phase * 2)
    strike = .22 * exp(-18 * time) * sin(phase * 3.005)
    return attack * release * exp(-5.5 * time) * (fundamental + strike)


def original_room_tone(time, frequency, duration):
    # Preserve the familiar connection and disconnection sounds.
    envelope = min(1, time / .035) * exp(-7 * time) * min(1, (duration - time) / .085)
    return envelope * (sin(tau * frequency * time) + .12 * sin(2 * tau * frequency * time))


def write_sounds(folder):
    # Each note holds its start time, pitch, tail length and relative strength.
    cues = {
        'message': (chime, [(0, 659.25, .26, .70), (.105, 880, .39, .83)]),
        'ring': (chime, [(0, 392, .58, .94), (.16, 493.88, .55, .80),
                         (.39, 659.25, .65, .94), (.74, 587.33, .66, .70)]),
        'joined': (original_room_tone, [(0, 440, .55, 1), (.13, 554.37, .55, 1)]),
        'ended': (original_room_tone, [(0, 440, .55, 1), (.16, 349.23, .55, 1)]),
    }
    rate = 32000
    for name, (instrument, notes) in cues.items():
        length = max(onset + duration for onset, _, duration, _ in notes) + .03
        samples = array('h')
        for frame in range(round(length * rate)):
            t = frame / rate
            sample = sum(strength * instrument(t - onset, pitch, duration)
                         for onset, pitch, duration, strength in notes if 0 <= t - onset < duration)
            samples.append(round(4700 * sample))
        if sys.byteorder != 'little':
            samples.byteswap()
        with wave.open(str(folder / (name + '.wav')), 'wb') as output:
            output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
            output.writeframes(samples.tobytes())


if __name__ == '__main__':
    write_sounds(Path(__file__).resolve().parents[1] / 'src/renderer/assets')
