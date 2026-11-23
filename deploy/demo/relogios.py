"""Compara o relógio local com uma leitura Unix em nanossegundos no outro host."""
import argparse
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tolerancia_segundos", type=int)
    parser.add_argument("comando", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not 0 <= args.tolerancia_segundos <= 3600 or not args.comando:
        parser.error("informe CLOCK_TOLERANCE_SECONDS (0 a 3600) e o comando de leitura")

    inicio = time.time_ns()
    try:
        leitura = subprocess.check_output(args.comando, timeout=10).strip()
        fim = time.time_ns()
        if not leitura.isdigit() or fim < inicio:
            raise ValueError("leitura de relógio inválida")
        remoto = int(leitura)
    except (OSError, ValueError, subprocess.SubprocessError) as erro:
        print(f"INCONCLUSIVO ({erro})")
        return 2

    # Arredondamento para fora mantém todo o intervalo possível, inclusive para desvios negativos.
    minimo_ms = (remoto - fim) // 1_000_000
    maximo_ms = -((inicio - remoto) // 1_000_000)
    limite_ms = args.tolerancia_segundos * 1000
    print(f"Remoto menos local [{minimo_ms}, {maximo_ms}] ms (tolerância ±{limite_ms} ms)")
    if -limite_ms <= minimo_ms and maximo_ms <= limite_ms:
        print("DENTRO")
        return 0
    if minimo_ms > limite_ms or maximo_ms < -limite_ms:
        print("ACIMA")
        return 1
    print("INCONCLUSIVO")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
