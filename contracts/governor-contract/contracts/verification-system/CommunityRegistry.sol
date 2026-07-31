// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

/**
 * @title CommunityRegistry
 * @notice The onchain address book for Netizen communities — one per chain.
 *         Maps a community id to its full civic contract set and the URI of its
 *         signed NSP-0 manifest, so every client, SDK, indexer and agent resolves
 *         a deployment from one read instead of hardcoding addresses.
 *
 *         Ids are first-come-first-served (by convention keccak256 of the
 *         community slug). Records are self-sovereign: only the community's
 *         controller — its timelock or Safe — may write. The registry itself is
 *         unowned and has no admin: it is a phone book, not a root of trust.
 *         Trust comes from the manifest signature and the membership contracts
 *         a record points at.
 */
contract CommunityRegistry {
    struct Community {
        address citizenNft;
        address attesterNft;
        address governor;
        address timelock;
        address maci;
        address safe;
        address gatekeeper; // optional — address(0) when absent
        address circlesGroup; // optional — address(0) when absent
        string manifestURI;
        address controller;
    }

    // controller == address(0) doubles as "id not registered".
    mapping(bytes32 => Community) private _communities;
    bytes32[] private _ids;

    event CommunityRegistered(bytes32 indexed id, address indexed controller);
    event CommunityUpdated(bytes32 indexed id);
    event ControllerChanged(bytes32 indexed id, address indexed previous, address indexed next);

    error IdTaken(bytes32 id);
    error UnknownId(bytes32 id);
    error NotController(bytes32 id, address caller);
    error ZeroController();

    modifier onlyController(bytes32 id) {
        address controller = _communities[id].controller;
        if (controller == address(0)) revert UnknownId(id);
        if (controller != msg.sender) revert NotController(id, msg.sender);
        _;
    }

    /// @notice Claim an id and write its record. `c.controller == address(0)`
    ///         defaults to the caller; pass the community's timelock/Safe to
    ///         hand over control in the same transaction.
    function register(bytes32 id, Community calldata c) external {
        if (_communities[id].controller != address(0)) revert IdTaken(id);
        Community memory rec = c;
        if (rec.controller == address(0)) rec.controller = msg.sender;
        _communities[id] = rec;
        _ids.push(id);
        emit CommunityRegistered(id, rec.controller);
    }

    /// @notice Replace the record. The controller field of the payload is
    ///         ignored — rotation is only ever the explicit setController event.
    function update(bytes32 id, Community calldata c) external onlyController(id) {
        Community memory rec = c;
        rec.controller = _communities[id].controller;
        _communities[id] = rec;
        emit CommunityUpdated(id);
    }

    function setController(bytes32 id, address next) external onlyController(id) {
        if (next == address(0)) revert ZeroController();
        address previous = _communities[id].controller;
        _communities[id].controller = next;
        emit ControllerChanged(id, previous, next);
    }

    function get(bytes32 id) external view returns (Community memory) {
        Community memory rec = _communities[id];
        if (rec.controller == address(0)) revert UnknownId(id);
        return rec;
    }

    function count() external view returns (uint256) {
        return _ids.length;
    }

    function idAt(uint256 index) external view returns (bytes32) {
        return _ids[index];
    }
}
