import { SignIdentity, PublicKey, HttpAgentRequest } from '@dfinity/agent';
import { BinaryBlob, blobFromBuffer, DerEncodedBlob } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { Buffer } from 'buffer/';
import { requestIdOf } from './utils/request_id';

type SignCb = (payload: ArrayBuffer) => Promise<ArrayBuffer>;

const domainSeparator = Buffer.from(new TextEncoder().encode('\x0Aic-request'));
interface SerializedPublicKey {
  rawKey: {
    type: string;
    data: Uint8Array;
  };
  derKey: {
    type: string;
    data: DerEncodedBlob;
  };
}
export class PlugIdentity extends SignIdentity {
  private publicKey: PublicKey;
  private whitelist: string[];
  constructor(publicKey: SerializedPublicKey, private signCb: SignCb, whitelist: string[]) {
    super();
    this.publicKey = { ...publicKey, toDer: () => publicKey.derKey?.data ?? publicKey.derKey };
    this.signCb = signCb;
    this.whitelist = whitelist || [];
  }
  
  getPublicKey(): PublicKey {
    return this.publicKey;
  }

  async sign(blob: BinaryBlob): Promise<BinaryBlob> {
    const res = await this.signCb(blob);
    return res as BinaryBlob;
  }

  getPrincipal(): Principal {
    if (!this._principal) {
      this._principal = Principal.selfAuthenticating(this.publicKey.toDer());
    }
    return this._principal;
  }
  /**
   * Transform a request into a signed version of the request. This is done last
   * after the transforms on the body of a request. The returned object can be
   * anything, but must be serializable to CBOR.
   * @param request - internet computer request to transform
   */
   public async transformRequest(request: HttpAgentRequest): Promise<unknown> {
    const { body, ...fields } = request;

    const canister = body?.canister_id instanceof Principal ? body?.canister_id : Principal.fromUint8Array(body?.canister_id?._arr);
    if (!this.whitelist.some(id => id === canister.toString())){
      throw new Error(`Request failed:\n` +
                `  Code: 401\n` +
                `  Body: Plug Identity is not allowed to make requests to canister Id ${canister.toString()}`);
    }
  
    const requestId = await requestIdOf(body);
    const sender_sig = await this.sign(blobFromBuffer(Buffer.concat([domainSeparator, requestId])))

    const transformedResponse = {
      ...fields,
      body: {
        content: {
          ...body,
          canister_id: canister
        },
        sender_pubkey: this.getPublicKey().toDer(),
        sender_sig
      },
    };
    return transformedResponse;
  }
}
