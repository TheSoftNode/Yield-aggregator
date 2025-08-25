import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const simnet = (globalThis as any).simnet;

const accounts = simnet.getAccounts();
const address1 = accounts.get("wallet_1")!;
const address2 = accounts.get("wallet_2")!; 
const address3 = accounts.get("wallet_3")!;
const deployer = accounts.get("deployer")!;

const contractName = "yield-aggregator";

// Error constants
const ERR_NOT_AUTHORIZED = 200;
const ERR_INSUFFICIENT_BALANCE = 201;
const ERR_INVALID_AMOUNT = 202;
const ERR_VAULT_NOT_FOUND = 203;
const ERR_STRATEGY_NOT_FOUND = 204;
const ERR_VAULT_PAUSED = 205;
const ERR_MINIMUM_DEPOSIT_NOT_MET = 206;
const ERR_WITHDRAWAL_TOO_LARGE = 207;


// Risk levels
const RISK_CONSERVATIVE = 1;
const RISK_BALANCED = 2;
const RISK_AGGRESSIVE = 3;

describe("StacksYield Aggregator Contract Tests", () => {
  beforeEach(() => {
    simnet.mineEmptyBlocks(1);
  });

  describe("Initial State & Read-Only Functions", () => {
    it("returns correct platform stats on initialization", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-platform-stats", [], deployer);
      expect(result).toBeOk(
        Cl.tuple({
          "total-value-locked": Cl.uint(0),
          "total-vaults": Cl.uint(0),
          "total-strategies": Cl.uint(3), // 3 default strategies
          "platform-fee-rate": Cl.uint(50), // 0.5%
          "emergency-pause": Cl.bool(false)
        })
      );
    });

    it("returns none for non-existent vault", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(999)], deployer);
      expect(result).toBeNone();
    });

    it("returns none for non-existent user position", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-user-position", [Cl.uint(1), Cl.principal(address1)], deployer);
      expect(result).toBeNone();
    });

    it("returns 0 for non-existent user vault value", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-user-vault-value", [Cl.uint(1), Cl.principal(address1)], deployer);
      expect(result).toBeUint(0);
    });

    it("returns default strategy information", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-strategy-info", [Cl.uint(1)], deployer);
      expect(result).toBeSome(
        Cl.tuple({
          name: Cl.stringAscii("STX-Staking-Strategy"),
          protocol: Cl.stringAscii("stx-vault"),
          apy: Cl.uint(1200), // 12%
          "tvl-capacity": Cl.uint(100000000000),
          "current-tvl": Cl.uint(0),
          "risk-score": Cl.uint(3),
          "is-active": Cl.bool(true),
          "contract-address": Cl.principal(deployer),
          "last-updated": Cl.uint(simnet.blockHeight)
        })
      );
    });

    it("returns best APY from available strategies", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-best-apy", [], deployer);
      expect(result).toBeUint(1500); // 15% from LP farming strategy
    });

    it("correctly identifies admin users", () => {
      const { result: ownerCheck } = simnet.callReadOnlyFn(contractName, "is-user-admin", [Cl.principal(deployer)], deployer);
      expect(ownerCheck).toBeBool(true);

      const { result: nonAdminCheck } = simnet.callReadOnlyFn(contractName, "is-user-admin", [Cl.principal(address1)], deployer);
      expect(nonAdminCheck).toBeBool(false);
    });

    it("returns empty vault list for new users", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-user-vaults", [Cl.principal(address1)], deployer);
      expect(result).toBeList([]);
    });
  });

  describe("Vault Creation", () => {
    it("allows admin to create conservative vault", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Conservative STX Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000) // 1 STX minimum
        ],
        deployer
      );
      expect(result).toBeOk(Cl.uint(1));
    });

    it("allows admin to create balanced vault", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Balanced Growth Vault"),
          Cl.uint(RISK_BALANCED),
          Cl.uint(5000000) // 5 STX minimum
        ],
        deployer
      );
      expect(result).toBeOk(Cl.uint(1));
    });

    it("allows admin to create aggressive vault", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("High Yield Vault"),
          Cl.uint(RISK_AGGRESSIVE),
          Cl.uint(10000000) // 10 STX minimum
        ],
        deployer
      );
      expect(result).toBeOk(Cl.uint(1));
    });

    it("prevents non-admin from creating vault", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Unauthorized Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
    });

    it("rejects invalid risk levels", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Invalid Risk Vault"),
          Cl.uint(5), // Invalid risk level
          Cl.uint(1000000)
        ],
        deployer
      );
      expect(result).toBeErr(Cl.uint(ERR_INVALID_AMOUNT));
    });

    it("updates platform stats after vault creation", () => {
      // Create a vault first
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Test Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        deployer
      );

      const { result } = simnet.callReadOnlyFn(contractName, "get-platform-stats", [], deployer);
      expect(result).toBeOk(
        Cl.tuple({
          "total-value-locked": Cl.uint(0),
          "total-vaults": Cl.uint(1),
          "total-strategies": Cl.uint(3),
          "platform-fee-rate": Cl.uint(50),
          "emergency-pause": Cl.bool(false)
        })
      );
    });
  });

  describe("Deposits", () => {
    beforeEach(() => {
      // Create a test vault
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Test Deposit Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000) // 1 STX minimum
        ],
        deployer
      );
    });

    it("allows user to make initial deposit", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(5000000)], // 5 STX
        address1
      );
      expect(result).toBeOk(Cl.uint(5000000)); // 1:1 share ratio for first deposit
    });

    it("updates vault totals after deposit", () => {
      // Make deposit
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(5000000)],
        address1
      );

      const { result } = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(1)], deployer);
      const vaultData = result.expectSome();
      expect(vaultData).toMatchObject({
        "total-shares": Cl.uint(5000000),
        "total-assets": Cl.uint(5000000)
      });
    });

    it("creates correct user position after deposit", () => {
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(5000000)],
        address1
      );

      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      
      const position = result.expectSome();
      expect(position).toMatchObject({
        shares: Cl.uint(5000000),
        "total-deposited": Cl.uint(5000000),
        "total-withdrawn": Cl.uint(0)
      });
    });

    it("rejects deposits below minimum", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(500000)], // 0.5 STX, below 1 STX minimum
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_MINIMUM_DEPOSIT_NOT_MET));
    });

    it("handles multiple deposits from same user", () => {
      // First deposit
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(5000000)],
        address1
      );

      // Second deposit
      const { result } = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(3000000)],
        address1
      );

      expect(result).toBeOk(Cl.uint(3000000));

      // Check updated position
      const { result: positionResult } = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      
      const position = positionResult.expectSome();
      expect(position).toMatchObject({
        shares: Cl.uint(8000000),
        "total-deposited": Cl.uint(8000000)
      });
    });

    it("handles deposits from multiple users", () => {
      // User 1 deposit
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(5000000)],
        address1
      );

      // User 2 deposit
      const { result } = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(3000000)],
        address2
      );

      expect(result).toBeOk(Cl.uint(3000000));

      // Check vault totals
      const { result: vaultResult } = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(1)], deployer);
      const vaultData = vaultResult.expectSome();
      expect(vaultData).toMatchObject({
        "total-shares": Cl.uint(8000000),
        "total-assets": Cl.uint(8000000)
      });
    });

    it("rejects deposits to non-existent vault", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(999), Cl.uint(5000000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_VAULT_NOT_FOUND));
    });

    it("updates user vault list after deposit", () => {
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(5000000)],
        address1
      );

      const { result } = simnet.callReadOnlyFn(contractName, "get-user-vaults", [Cl.principal(address1)], deployer);
      expect(result).toBeList([Cl.uint(1)]);
    });
  });

  describe("Withdrawals", () => {
    beforeEach(() => {
      // Create vault and make initial deposit
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Test Withdrawal Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        deployer
      );
      
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(10000000)], // 10 STX
        address1
      );
    });

    it("allows partial withdrawal", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(3000000)], // Withdraw 3 shares
        address1
      );
      
      // Should receive slightly less due to platform fee
      expect(result).toBeOk(Cl.uint(2985000)); // 3 STX - 0.5% fee
    });

    it("allows full withdrawal", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(10000000)], // Withdraw all shares
        address1
      );
      
      expect(result).toBeOk(Cl.uint(9950000)); // 10 STX - 0.5% fee
    });

    it("updates user position after partial withdrawal", () => {
      simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(3000000)],
        address1
      );

      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      
      const position = result.expectSome();
      expect(position).toMatchObject({
        shares: Cl.uint(7000000),
        "total-withdrawn": Cl.uint(2985000)
      });
    });

    it("removes user position after full withdrawal", () => {
      simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(10000000)],
        address1
      );

      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      
      expect(result).toBeNone();
    });

    it("rejects withdrawal larger than user shares", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(15000000)], // More than deposited
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_WITHDRAWAL_TOO_LARGE));
    });

    it("rejects withdrawal from user with no position", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(1000000)],
        address2 // User with no position
      );
      expect(result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
    });

    it("rejects zero withdrawal", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(0)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_INVALID_AMOUNT));
    });

    it("updates vault totals after withdrawal", () => {
      simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(3000000)],
        address1
      );

      const { result } = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(1)], deployer);
      const vaultData = result.expectSome();
      expect(vaultData).toMatchObject({
        "total-shares": Cl.uint(7000000),
        "total-assets": Cl.uint(7000000)
      });
    });
  });

  describe("Vault Harvesting", () => {
    beforeEach(() => {
      // Create vault and deposit
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Harvest Test Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        deployer
      );
      
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(10000000)],
        address1
      );
    });

    it("allows harvesting of vault earnings", () => {
      // Mine some blocks to simulate passage of time
      simnet.mineEmptyBlocks(100);
      
      const { result } = simnet.callPublicFn(
        contractName,
        "harvest-vault",
        [Cl.uint(1)],
        address1
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("rejects harvesting non-existent vault", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "harvest-vault",
        [Cl.uint(999)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_VAULT_NOT_FOUND));
    });
  });

  describe("Strategy Management", () => {
    it("allows admin to add new strategy", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "add-strategy",
        [
          Cl.stringAscii("New High Yield Strategy"),
          Cl.stringAscii("new-protocol"),
          Cl.uint(2000), // 20% APY
          Cl.uint(10000000000), // 10k STX capacity
          Cl.uint(8), // High risk
          Cl.principal(deployer)
        ],
        deployer
      );
      expect(result).toBeOk(Cl.uint(4)); // Should be strategy ID 4
    });

    it("prevents non-admin from adding strategy", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "add-strategy",
        [
          Cl.stringAscii("Unauthorized Strategy"),
          Cl.stringAscii("hack-protocol"),
          Cl.uint(9999),
          Cl.uint(1000000),
          Cl.uint(10),
          Cl.principal(address1)
        ],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
    });

    it("allows admin to update strategy APY", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-strategy-apy",
        [Cl.uint(1), Cl.uint(1400)], // Update to 14%
        deployer
      );
      expect(result).toBeOk(Cl.uint(1400));
    });

    it("prevents non-admin from updating strategy APY", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-strategy-apy",
        [Cl.uint(1), Cl.uint(9999)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
    });

    it("rejects updating non-existent strategy", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-strategy-apy",
        [Cl.uint(999), Cl.uint(1000)],
        deployer
      );
      expect(result).toBeErr(Cl.uint(ERR_STRATEGY_NOT_FOUND));
    });
  });

  describe("Vault Rebalancing", () => {
    beforeEach(() => {
      // Create vault
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Rebalance Test Vault"),
          Cl.uint(RISK_BALANCED),
          Cl.uint(1000000)
        ],
        deployer
      );
    });

    it("allows admin to rebalance vault strategy", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "rebalance-vault",
        [Cl.uint(1), Cl.uint(3)], // Switch to LP farming strategy
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("prevents non-admin from rebalancing", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "rebalance-vault",
        [Cl.uint(1), Cl.uint(3)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
    });

    it("rejects rebalancing to non-existent strategy", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "rebalance-vault",
        [Cl.uint(1), Cl.uint(999)],
        deployer
      );
      expect(result).toBeErr(Cl.uint(ERR_STRATEGY_NOT_FOUND));
    });

    it("rejects rebalancing non-existent vault", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "rebalance-vault",
        [Cl.uint(999), Cl.uint(2)],
        deployer
      );
      expect(result).toBeErr(Cl.uint(ERR_VAULT_NOT_FOUND));
    });
  });

  describe("Admin Functions", () => {
    it("allows owner to add new admin", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "add-admin",
        [Cl.principal(address1)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify admin status
      const { result: adminCheck } = simnet.callReadOnlyFn(
        contractName,
        "is-user-admin", 
        [Cl.principal(address1)], 
        deployer
      );
      expect(adminCheck).toBeBool(true);
    });

    it("prevents non-owner from adding admin", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "add-admin",
        [Cl.principal(address2)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
    });

    it("allows admin to set platform fee", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-platform-fee",
        [Cl.uint(75)], // 0.75%
        deployer
      );
      expect(result).toBeOk(Cl.uint(75));
    });

    it("rejects platform fee above maximum", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-platform-fee",
        [Cl.uint(1001)], // 10.01% - above 10% max
        deployer
      );
      expect(result).toBeErr(Cl.uint(ERR_INVALID_AMOUNT));
    });

    it("prevents non-admin from setting platform fee", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-platform-fee",
        [Cl.uint(100)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
    });

    it("allows admin to toggle emergency pause", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "toggle-emergency-pause",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true)); // Now paused

      // Toggle again
      const { result: secondToggle } = simnet.callPublicFn(
        contractName,
        "toggle-emergency-pause",
        [],
        deployer
      );
      expect(secondToggle).toBeOk(Cl.bool(false)); // Now unpaused
    });

    it("prevents non-admin from toggling emergency pause", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "toggle-emergency-pause",
        [],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
    });
  });

  describe("Emergency Pause Functionality", () => {
    beforeEach(() => {
      // Create vault for testing
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Pause Test Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        deployer
      );

      // Enable emergency pause
      simnet.callPublicFn(
        contractName,
        "toggle-emergency-pause",
        [],
        deployer
      );
    });

    it("prevents vault creation when paused", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Paused Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        deployer
      );
      expect(result).toBeErr(Cl.uint(ERR_VAULT_PAUSED));
    });

    it("prevents deposits when paused", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(5000000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_VAULT_PAUSED));
    });

    it("prevents withdrawals when paused", () => {
      // First unpause to make a deposit
      simnet.callPublicFn(contractName, "toggle-emergency-pause", [], deployer);
      simnet.callPublicFn(contractName, "deposit", [Cl.uint(1), Cl.uint(5000000)], address1);
      
      // Re-enable pause
      simnet.callPublicFn(contractName, "toggle-emergency-pause", [], deployer);

      const { result } = simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(1000000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_VAULT_PAUSED));
    });

    it("prevents harvesting when paused", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "harvest-vault",
        [Cl.uint(1)],
        address1
      );
      expect(result).toBeErr(Cl.uint(ERR_VAULT_PAUSED));
    });
  });

  describe("Integration Tests", () => {
    it("handles complete user journey", () => {
      // 1. Admin creates multiple vaults
      const vault1 = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Conservative Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        deployer
      );
      expect(vault1.result).toBeOk(Cl.uint(1));

      const vault2 = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Aggressive Vault"),
          Cl.uint(RISK_AGGRESSIVE),
          Cl.uint(5000000)
        ],
        deployer
      );
      expect(vault2.result).toBeOk(Cl.uint(2));

      // 2. User deposits into both vaults
      const deposit1 = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(10000000)], // 10 STX
        address1
      );
      expect(deposit1.result).toBeOk(Cl.uint(10000000));

      const deposit2 = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(2), Cl.uint(20000000)], // 20 STX
        address1
      );
      expect(deposit2.result).toBeOk(Cl.uint(20000000));

      // 3. Check user's vault list
      const userVaults = simnet.callReadOnlyFn(
        contractName,
        "get-user-vaults",
        [Cl.principal(address1)],
        deployer
      );
      expect(userVaults.result).toBeList([Cl.uint(1), Cl.uint(2)]);

      // 4. Mine blocks to simulate yield generation
      simnet.mineEmptyBlocks(1000);

      // 5. Harvest vaults
      const harvest1 = simnet.callPublicFn(
        contractName,
        "harvest-vault",
        [Cl.uint(1)],
        address1
      );
      expect(harvest1.result).toBeOk(Cl.bool(true));

      // 6. Partial withdrawal from first vault
      const withdrawal = simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(5000000)], // Withdraw 5 shares
        address1
      );
      expect(withdrawal.result).toBeOk(Cl.uint(4975000)); // With 0.5% fee

      // 7. Check updated position
      const position = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      const positionData = position.result.expectSome();
      expect(positionData).toMatchObject({
        shares: Cl.uint(5000000), // Remaining shares
        "total-withdrawn": Cl.uint(4975000)
      });

      // 8. Check platform stats
      const stats = simnet.callReadOnlyFn(contractName, "get-platform-stats", [], deployer);
      expect(stats.result).toBeOk(
        Cl.tuple({
          "total-value-locked": Cl.uint(25000000), // 30M deposited - 5M withdrawn
          "total-vaults": Cl.uint(2),
          "total-strategies": Cl.uint(3),
          "platform-fee-rate": Cl.uint(50),
          "emergency-pause": Cl.bool(false)
        })
      );
    });

    it("handles multiple users interacting with same vault", () => {
      // Create vault
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Multi-User Vault"),
          Cl.uint(RISK_BALANCED),
          Cl.uint(1000000)
        ],
        deployer
      );

      // User 1 deposits
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(10000000)],
        address1
      );

      // User 2 deposits
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(5000000)],
        address2
      );

      // User 3 deposits
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(15000000)],
        address3
      );

      // Check vault totals
      const vaultInfo = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(1)], deployer);
      const vaultData = vaultInfo.result.expectSome();
      expect(vaultData).toMatchObject({
        "total-shares": Cl.uint(30000000),
        "total-assets": Cl.uint(30000000)
      });

      // Check individual positions
      const pos1 = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      expect(pos1.result.expectSome()).toMatchObject({
        shares: Cl.uint(10000000)
      });

      const pos2 = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address2)],
        deployer
      );
      expect(pos2.result.expectSome()).toMatchObject({
        shares: Cl.uint(5000000)
      });

      // User 2 withdraws everything
      const withdrawal = simnet.callPublicFn(
        contractName,
        "withdraw",
        [Cl.uint(1), Cl.uint(5000000)],
        address2
      );
      expect(withdrawal.result).toBeOk(Cl.uint(4975000));

      // Check User 2 position is removed
      const pos2After = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address2)],
        deployer
      );
      expect(pos2After.result).toBeNone();

      // Check vault totals updated
      const vaultInfoAfter = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(1)], deployer);
      const vaultDataAfter = vaultInfoAfter.result.expectSome();
      expect(vaultDataAfter).toMatchObject({
        "total-shares": Cl.uint(25000000),
        "total-assets": Cl.uint(25000000)
      });
    });

    it("handles strategy updates and rebalancing", () => {
      // Create vault
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Strategy Test Vault"),
          Cl.uint(RISK_AGGRESSIVE),
          Cl.uint(1000000)
        ],
        deployer
      );

      // Add user deposit
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(10000000)],
        address1
      );

      // Check initial strategy (should be aggressive = strategy 3)
      const initialVault = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(1)], deployer);
      const initialData = initialVault.result.expectSome();
      expect(initialData).toMatchObject({
        "strategy-id": Cl.uint(3) // LP farming strategy for aggressive
      });

      // Add new strategy
      const newStrategy = simnet.callPublicFn(
        contractName,
        "add-strategy",
        [
          Cl.stringAscii("Super High Yield"),
          Cl.stringAscii("defi-protocol"),
          Cl.uint(2500), // 25% APY
          Cl.uint(50000000000),
          Cl.uint(9), // Very high risk
          Cl.principal(deployer)
        ],
        deployer
      );
      expect(newStrategy.result).toBeOk(Cl.uint(4));

      // Rebalance vault to new strategy
      const rebalance = simnet.callPublicFn(
        contractName,
        "rebalance-vault",
        [Cl.uint(1), Cl.uint(4)],
        deployer
      );
      expect(rebalance.result).toBeOk(Cl.bool(true));

      // Check vault uses new strategy
      const updatedVault = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(1)], deployer);
      const updatedData = updatedVault.result.expectSome();
      expect(updatedData).toMatchObject({
        "strategy-id": Cl.uint(4)
      });

      // Update strategy APY
      const updateAPY = simnet.callPublicFn(
        contractName,
        "update-strategy-apy",
        [Cl.uint(4), Cl.uint(3000)], // Update to 30%
        deployer
      );
      expect(updateAPY.result).toBeOk(Cl.uint(3000));

      // Verify strategy update
      const strategyInfo = simnet.callReadOnlyFn(contractName, "get-strategy-info", [Cl.uint(4)], deployer);
      const strategyData = strategyInfo.result.expectSome();
      expect(strategyData).toMatchObject({
        apy: Cl.uint(3000),
        name: Cl.stringAscii("Super High Yield")
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("handles vault with zero total assets correctly", () => {
      // Create vault but don't deposit
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Empty Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        deployer
      );

      // Try to get user vault value (should be 0)
      const value = simnet.callReadOnlyFn(
        contractName,
        "get-user-vault-value",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      expect(value.result).toBeUint(0);
    });

    it("handles large deposit amounts", () => {
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Large Deposit Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        deployer
      );

      const largeDeposit = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(1000000000000)], // 1M STX
        address1
      );
      expect(largeDeposit.result).toBeOk(Cl.uint(1000000000000));
    });

    it("handles precision in share calculations", () => {
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Precision Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1)
        ],
        deployer
      );

      // First deposit
      simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(1000000)],
        address1
      );

      // Second deposit (different amount)
      const secondDeposit = simnet.callPublicFn(
        contractName,
        "deposit",
        [Cl.uint(1), Cl.uint(1500000)],
        address2
      );
      expect(secondDeposit.result).toBeOk(Cl.uint(1500000));

      // Check proportional shares
      const pos1 = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      expect(pos1.result.expectSome()).toMatchObject({
        shares: Cl.uint(1000000)
      });

      const pos2 = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address2)],
        deployer
      );
      expect(pos2.result.expectSome()).toMatchObject({
        shares: Cl.uint(1500000)
      });
    });

    it("handles admin role management correctly", () => {
      // Add admin
      simnet.callPublicFn(
        contractName,
        "add-admin",
        [Cl.principal(address1)],
        deployer
      );

      // New admin can create vault
      const vaultCreation = simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Admin Created Vault"),
          Cl.uint(RISK_CONSERVATIVE),
          Cl.uint(1000000)
        ],
        address1
      );
      expect(vaultCreation.result).toBeOk(Cl.uint(1));

      // New admin can add strategy
      const strategyCreation = simnet.callPublicFn(
        contractName,
        "add-strategy",
        [
          Cl.stringAscii("Admin Strategy"),
          Cl.stringAscii("admin-protocol"),
          Cl.uint(1000),
          Cl.uint(10000000000),
          Cl.uint(5),
          Cl.principal(address1)
        ],
        address1
      );
      expect(strategyCreation.result).toBeOk(Cl.uint(4));

      // Original owner can still perform admin functions
      const ownerStrategy = simnet.callPublicFn(
        contractName,
        "update-strategy-apy",
        [Cl.uint(1), Cl.uint(1300)],
        deployer
      );
      expect(ownerStrategy.result).toBeOk(Cl.uint(1300));
    });
  });

  describe("Gas and Performance Tests", () => {
    it("handles multiple deposits efficiently", () => {
      // Create vault
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Performance Vault"),
          Cl.uint(RISK_BALANCED),
          Cl.uint(1000000)
        ],
        deployer
      );

      // Make 10 deposits from same user
      for (let i = 0; i < 10; i++) {
        const deposit = simnet.callPublicFn(
          contractName,
          "deposit",
          [Cl.uint(1), Cl.uint(1000000 * (i + 1))],
          address1
        );
        expect(deposit.result).toBeOk(Cl.uint(1000000 * (i + 1)));
      }

      // Check final position
      const finalPosition = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address1)],
        deployer
      );
      const positionData = finalPosition.result.expectSome();
      expect(positionData).toMatchObject({
        shares: Cl.uint(55000000), // Sum of 1+2+3+...+10 million
        "total-deposited": Cl.uint(55000000)
      });
    });

    it("handles multiple users per vault efficiently", () => {
      // Create vault
      simnet.callPublicFn(
        contractName,
        "create-vault",
        [
          Cl.stringAscii("Multi-User Performance Vault"),
          Cl.uint(RISK_BALANCED),
          Cl.uint(1000000)
        ],
        deployer
      );

      // All three users deposit
      const users = [address1, address2, address3];
      users.forEach((user, index) => {
        const deposit = simnet.callPublicFn(
          contractName,
          "deposit",
          [Cl.uint(1), Cl.uint(5000000 * (index + 1))],
          user
        );
        expect(deposit.result).toBeOk(Cl.uint(5000000 * (index + 1)));
      });

      // Check vault totals
      const vaultInfo = simnet.callReadOnlyFn(contractName, "get-vault-info", [Cl.uint(1)], deployer);
      const vaultData = vaultInfo.result.expectSome();
      expect(vaultData).toMatchObject({
        "total-shares": Cl.uint(30000000), // 5M + 10M + 15M
        "total-assets": Cl.uint(30000000)
      });

      // All users can check their vault lists
      users.forEach(user => {
        const userVaults = simnet.callReadOnlyFn(
          contractName,
          "get-user-vaults",
          [Cl.principal(user)],
          deployer
        );
        expect(userVaults.result).toBeList([Cl.uint(1)]);
      });
    });
  });
});