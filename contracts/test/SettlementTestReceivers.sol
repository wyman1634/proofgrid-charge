// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract RejectingReceiver {
    receive() external payable {
        revert("payment rejected");
    }
}

interface IChargingSessionFunding {
    function createChargingSession(
        bytes32 sessionId,
        bytes32 stationId,
        uint256 maxEnergyWh,
        uint256 deadline
    ) external payable;
}

contract RejectingDriver {
    function createChargingSession(
        address chargeContract,
        bytes32 sessionId,
        bytes32 stationId,
        uint256 maxEnergyWh,
        uint256 deadline
    ) external payable {
        IChargingSessionFunding(chargeContract).createChargingSession{value: msg.value}(
            sessionId,
            stationId,
            maxEnergyWh,
            deadline
        );
    }

    receive() external payable {
        revert("refund rejected");
    }
}

contract ReenteringOperator {
    address private target;
    bytes private settlementCall;
    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryResult;

    function arm(address target_, bytes calldata settlementCall_) external {
        target = target_;
        settlementCall = settlementCall_;
    }

    receive() external payable {
        attempted = true;
        (reentrySucceeded, reentryResult) = target.call(settlementCall);
    }
}
