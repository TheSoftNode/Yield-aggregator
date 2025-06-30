;; StacksYield - Yield Aggregator Smart Contract
;; Automatically finds and compounds the best yield opportunities across DeFi protocols

;; Constants
(define-constant CONTRACT_OWNER tx-sender)
(define-constant ERR_NOT_AUTHORIZED (err u200))
(define-constant ERR_INSUFFICIENT_BALANCE (err u201))
(define-constant ERR_INVALID_AMOUNT (err u202))
(define-constant ERR_VAULT_NOT_FOUND (err u203))
(define-constant ERR_STRATEGY_NOT_FOUND (err u204))
(define-constant ERR_VAULT_PAUSED (err u205))
(define-constant ERR_MINIMUM_DEPOSIT_NOT_MET (err u206))
(define-constant ERR_WITHDRAWAL_TOO_LARGE (err u207))
(define-constant ERR_STRATEGY_INACTIVE (err u208))
(define-constant ERR_REBALANCE_TOO_FREQUENT (err u209))
(define-constant ERR_INVALID_VAULT_ID (err u210))

;; Data Variables
(define-data-var total-value-locked uint u0)
(define-data-var vault-counter uint u0)
(define-data-var strategy-counter uint u0)
(define-data-var platform-fee-rate uint u50) ;; 0.5% platform fee
(define-data-var performance-fee-rate uint u1000) ;; 10% performance fee
(define-data-var treasury principal CONTRACT_OWNER)
(define-data-var emergency-pause bool false)

;; Data Maps
(define-map vaults
    uint
    {
        name: (string-ascii 64),
        asset: principal,
        total-shares: uint,
        total-assets: uint,
        strategy-id: uint,
        risk-level: uint, ;; 1=conservative, 2=balanced, 3=aggressive
        min-deposit: uint,
        is-active: bool,
        created-at: uint,
        last-harvest: uint,
    }
)

(define-map user-positions
    {
        vault-id: uint,
        user: principal,
    }
    {
        shares: uint,
        deposited-at: uint,
        last-compound: uint,
        total-deposited: uint,
        total-withdrawn: uint,
    }
)

(define-map yield-strategies
    uint
    {
        name: (string-ascii 64),
        protocol: (string-ascii 32),
        apy: uint, ;; APY in basis points (e.g., 1000 = 10%)
        tvl-capacity: uint,
        current-tvl: uint,
        risk-score: uint, ;; 1-10 risk rating
        is-active: bool,
        contract-address: principal,
        last-updated: uint,
    }
)

(define-map vault-strategies
    uint
    (list 5 uint) ;; Up to 5 strategies per vault
)

(define-map user-vault-list
    principal
    (list 20 uint) ;; Track user's vaults
)

(define-map strategy-allocations
    {
        vault-id: uint,
        strategy-id: uint,
    }
    uint ;; Percentage allocation (0-10000 basis points)
)

(define-map admin-roles
    principal
    bool
)
