// Anthropic SDK client — direct API (no Worker needed in Node.js)
import Anthropic from '@anthropic-ai/sdk';

let client = null;

function getClient() {
    if (!client) {
        client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return client;
}

/**
 * Call Claude Sonnet for agent decision-making
 * @param {string} prompt - The user message content
 * @param {object} options - Optional overrides
 * @returns {string} The text response from Claude
 */
export async function callClaude(prompt, options = {}) {
    const response = await getClient().messages.create({
        model: options.model || 'claude-sonnet-4-6',
        max_tokens: options.maxTokens || 8000,
        messages: [{ role: 'user', content: prompt }],
    });

    // Extract text from content blocks
    let text = '';
    for (const block of response.content) {
        if (block.type === 'text') text += block.text;
    }

    return text;
}
