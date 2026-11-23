"""Valida os limites em MiB usados no pré-voo e na consolidação da demo."""
import json
import math
import sys


def positivo_finito(nome, texto):
    mensagem = f"{nome} deve ser um valor positivo e finito em MiB"
    try:
        valor = float(texto)
    except ValueError:
        raise SystemExit(mensagem) from None
    if not math.isfinite(valor) or valor <= 0:
        sys.exit(mensagem)
    return valor


def limites(orcamento, margem):
    return positivo_finito("STACK_BUDGET_MIB", orcamento), positivo_finito("MIN_MARGIN_MIB", margem)


if __name__ == "__main__":
    orcamento, _ = limites(*sys.argv[1:3])
    servicos = json.load(sys.stdin)["services"]
    soma = sum(int(servicos[nome]["mem_limit"]) for nome in sys.argv[3:]) / 1048576
    if soma > orcamento:
        sys.exit(f"Soma dos limites {soma:g} MiB supera orçamento {orcamento:g} MiB")
